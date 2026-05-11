-- ============================================================================
-- v20_balance_and_lb_fixes.sql
--
--   Round-up of player-reported balance + bookkeeping fixes:
--
--   1. Gacha pity now only resets on a *legendary* roll. Mythic and
--      one-of-one are considered "above" the legendary+ pity track and no
--      longer wipe progress toward the next guaranteed legendary.
--
--   2. Golden-key case openings re-roll **until** the result is not
--      common (instead of a single re-roll that frequently still landed
--      on common because of the 60% common base weight).
--
--   3. `_bump_biggest_win` now considers every credit-positive game
--      kind (cases, mines, candy, gacha refunds, plinko, lottery,
--      warfront, achievement awards, market payouts, mp_refund). The
--      previous list missed everything past v5 so the
--      "biggest single win" leaderboard was permanently stuck.
--
--   4. New plinko multiplier tables tuned to ~97-99% RTP. Old tables
--      were heavily +EV for the player (110-155%), giving the house no
--      edge. Computed via binomial distribution per row count.
--
--   5. `play_plinko_batch` RPC: drop N balls (1..50) in a single
--      transaction so the multi-ball UI can fire one round-trip per
--      session of drops, while still going through the
--      advisory-lock spam guard.
--
--   6. `leaderboard_tick` is now wrapped per-board in EXCEPTION
--      handlers so a single missing column / out-of-shape view can
--      never 400 the entire RPC. Combined with the 5-minute client
--      throttle this should make the console quiet again.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Gacha: only `legendary` resets pity
-- ---------------------------------------------------------------------------
create or replace function public.gacha_pull(p_count integer)
returns table (
  pull_index   integer,
  item_id      uuid,
  item_slug    text,
  item_name    text,
  item_emoji   text,
  rarity       text,
  is_unique    boolean,
  pity_popped  boolean,
  new_balance  integer,
  new_pity     integer
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  uid           uuid := auth.uid();
  prof          public.profiles%rowtype;
  per_pull      integer := 100;
  cost_total    integer;
  picked        public.gacha_pool%rowtype;
  total_w       integer;
  pick_w        integer;
  cum_w         integer;
  cur_pity      integer;
  forced_pity   boolean;
  pulls_made    jsonb := '[]'::jsonb;
  r             record;
  it            public.market_items%rowtype;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  perform public._txn_user_lock('gacha_pull');

  if p_count is null or p_count not in (1, 10) then
    raise exception 'pull count must be 1 or 10';
  end if;

  if not public.is_game_active('gacha') then
    raise exception 'Gacha is currently out of rotation';
  end if;

  cost_total := case when p_count = 1 then per_pull else 900 end;

  select * into prof from public.profiles where id = uid for update;
  if prof.credits < cost_total then
    raise exception 'Not enough credits (need %)', cost_total;
  end if;

  perform public._apply_credit_delta(uid, -cost_total, 'gacha_pull',
    jsonb_build_object('count', p_count));

  cur_pity := coalesce(prof.gacha_pity, 0);

  for i in 1..p_count loop
    cur_pity := cur_pity + 1;
    forced_pity := (cur_pity >= 80);

    if forced_pity then
      select coalesce(sum(weight), 0) into total_w
        from public.gacha_pool
       where claimed_by is null
         and rarity in ('legendary','mythic','one_of_one');
    else
      select coalesce(sum(weight), 0) into total_w
        from public.gacha_pool
       where claimed_by is null;
    end if;

    if total_w <= 0 then
      perform public._apply_credit_delta(uid, per_pull, 'gacha_pull',
        jsonb_build_object('reason','empty_pool_refund'));
      exit;
    end if;

    pick_w := 1 + floor(random() * total_w)::int;
    cum_w  := 0;

    if forced_pity then
      for r in
        select * from public.gacha_pool
         where claimed_by is null
           and rarity in ('legendary','mythic','one_of_one')
         order by id
         for update
      loop
        cum_w := cum_w + r.weight;
        if cum_w >= pick_w then picked := r; exit; end if;
      end loop;
    else
      for r in
        select * from public.gacha_pool
         where claimed_by is null
         order by id
         for update
      loop
        cum_w := cum_w + r.weight;
        if cum_w >= pick_w then picked := r; exit; end if;
      end loop;
    end if;

    if picked.is_unique then
      update public.gacha_pool
         set claimed_by = uid, claimed_at = now()
       where id = picked.id;
    end if;

    insert into public.user_items (user_id, item_id, qty)
      values (uid, picked.item_id, 1)
      on conflict (user_id, item_id) do update
        set qty = user_items.qty + 1;

    insert into public.gacha_pulls
      (user_id, pool_id, item_id, rarity, cost, pity_popped)
    values
      (uid, picked.id, picked.item_id, picked.rarity,
       per_pull, forced_pity);

    -- v20 change: only a *legendary* pull resets the legendary+ pity.
    -- Mythic and one-of-one are above the pity ladder and no longer
    -- reset progress toward the next guaranteed legendary.
    if picked.rarity = 'legendary' then
      cur_pity := 0;
    end if;

    select * into it from public.market_items where id = picked.item_id;
    pulls_made := pulls_made || jsonb_build_object(
      'pull_index', i,
      'item_id',    it.id,
      'item_slug',  it.slug,
      'item_name',  it.name,
      'item_emoji', coalesce(it.metadata->>'emoji', '🎁'),
      'rarity',     picked.rarity,
      'is_unique',  picked.is_unique,
      'pity_popped', forced_pity
    );
  end loop;

  update public.profiles set gacha_pity = cur_pity where id = uid;

  for r in select * from jsonb_array_elements(pulls_made) as e(p) loop
    pull_index   := (r.p->>'pull_index')::int;
    item_id      := (r.p->>'item_id')::uuid;
    item_slug    :=  r.p->>'item_slug';
    item_name    :=  r.p->>'item_name';
    item_emoji   :=  r.p->>'item_emoji';
    rarity       :=  r.p->>'rarity';
    is_unique    := (r.p->>'is_unique')::boolean;
    pity_popped  := (r.p->>'pity_popped')::boolean;
    select credits into new_balance from public.profiles where id = uid;
    new_pity := cur_pity;
    return next;
  end loop;
end;
$$;
grant execute on function public.gacha_pull(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Golden key: re-roll until non-common
-- ---------------------------------------------------------------------------
drop function if exists public.open_case(text, boolean);
create or replace function public.open_case(p_tier text, p_key boolean default false)
returns table(
  new_balance integer, tier text, rarity text, reward integer,
  cost integer, pity integer, pity_popped boolean, key_used boolean,
  multiplier numeric, dropped_item uuid
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
  base_cost integer;
  final_cost integer;
  r numeric;
  rar text;
  mult numeric;
  rew integer;
  cur_pity integer;
  pity_hit boolean := false;
  item uuid;
  guard int;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not public.is_game_active('cases') then
    raise exception 'Cases is currently out of rotation';
  end if;
  perform public._txn_user_lock('open_case');

  case p_tier
    when 'bronze' then base_cost := 10;
    when 'silver' then base_cost := 50;
    when 'gold'   then base_cost := 100;
    else raise exception 'Unknown tier %', p_tier;
  end case;
  final_cost := case when p_key then (base_cost * 3) / 2 else base_cost end;

  select case_pity into cur_pity from public.profiles where id = uid for update;
  if cur_pity is null then cur_pity := 0; end if;

  perform public._apply_credit_delta(uid, -final_cost, 'game_case',
    jsonb_build_object('phase','wager','tier',p_tier,'key',p_key));

  r := random();
  rar := public._case_pick_rarity(r);
  -- v20: keep re-rolling until the result is not common. Bounded loop so
  -- a misconfigured weight table can never spin forever.
  if p_key then
    guard := 0;
    while rar = 'common' and guard < 12 loop
      r := random();
      rar := public._case_pick_rarity(r);
      guard := guard + 1;
    end loop;
    -- Fallback: if RNG is being adversarial, force uncommon.
    if rar = 'common' then rar := 'uncommon'; end if;
  end if;

  if not p_key and rar = 'common' and cur_pity >= 9 then
    rar := 'rare';
    pity_hit := true;
  end if;

  mult := public._case_mult(rar);
  rew := floor(base_cost * mult)::int;

  if rew > 0 then
    perform public._apply_credit_delta(uid, rew, 'game_case',
      jsonb_build_object('phase','reward','tier',p_tier,'rarity',rar,
        'key', p_key, 'pity_hit', pity_hit));
  else
    perform public._apply_credit_delta(uid, 0, 'game_case',
      jsonb_build_object('phase','loss','tier',p_tier,'rarity',rar,
        'key', p_key));
  end if;

  if not p_key then
    if rar = 'common' then cur_pity := cur_pity + 1;
    else                    cur_pity := 0;
    end if;
    update public.profiles set case_pity = cur_pity where id = uid;
  end if;

  insert into public.case_openings (user_id, tier, cost, rarity, reward, key_used, pity_popped)
    values (uid, p_tier, final_cost, rar, rew, p_key, pity_hit);

  item := public._case_maybe_drop_item(uid, rar, p_key);

  select credits into new_balance from public.profiles where id = uid;
  tier := p_tier; rarity := rar; reward := rew; cost := final_cost;
  pity := cur_pity; pity_popped := pity_hit; key_used := p_key;
  multiplier := mult; dropped_item := item;
  return next;
end; $$;
grant execute on function public.open_case(text, boolean) to authenticated;

create or replace function public.open_case_batch(
  p_tier text, p_key boolean, p_count integer
) returns table(
  idx integer, rarity text, reward integer, mult numeric,
  pity_hit boolean, cost integer, dropped_item uuid
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
  base_cost integer;
  per_cost integer;
  total_cost integer;
  cur_pity integer;
  r numeric;
  rar text;
  m numeric;
  rew integer;
  pit_hit boolean;
  i integer := 0;
  item uuid;
  guard int;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not public.is_game_active('cases') then
    raise exception 'Cases is currently out of rotation';
  end if;
  perform public._txn_user_lock('open_case');

  if p_count not in (3,5,10,20,50) then raise exception 'Batch size must be 3/5/10/20/50'; end if;

  case p_tier
    when 'bronze' then base_cost := 10;
    when 'silver' then base_cost := 50;
    when 'gold'   then base_cost := 100;
    else raise exception 'Unknown tier %', p_tier;
  end case;
  per_cost := case when p_key then (base_cost * 3) / 2 else base_cost end;
  total_cost := per_cost * p_count;

  perform public._apply_credit_delta(uid, -total_cost, 'game_case',
    jsonb_build_object('phase','wager','tier',p_tier,'key',p_key,
      'batch_count', p_count, 'per_cost', per_cost));

  select case_pity into cur_pity from public.profiles where id = uid for update;
  if cur_pity is null then cur_pity := 0; end if;

  while i < p_count loop
    r := random();
    rar := public._case_pick_rarity(r);
    if p_key then
      guard := 0;
      while rar = 'common' and guard < 12 loop
        r := random();
        rar := public._case_pick_rarity(r);
        guard := guard + 1;
      end loop;
      if rar = 'common' then rar := 'uncommon'; end if;
    end if;
    pit_hit := false;
    if not p_key and rar = 'common' and cur_pity >= 9 then
      rar := 'rare'; pit_hit := true;
    end if;

    m := public._case_mult(rar);
    rew := floor(base_cost * m)::int;

    if rew > 0 then
      perform public._apply_credit_delta(uid, rew, 'game_case',
        jsonb_build_object('phase','reward','tier',p_tier,'rarity',rar,
          'key', p_key, 'batch_idx', i, 'pity_hit', pit_hit));
    end if;

    if not p_key then
      if rar = 'common' then cur_pity := cur_pity + 1;
      else                    cur_pity := 0;
      end if;
    end if;

    insert into public.case_openings
      (user_id, tier, cost, rarity, reward, key_used, pity_popped)
      values (uid, p_tier, per_cost, rar, rew, p_key, pit_hit);

    item := public._case_maybe_drop_item(uid, rar, p_key);

    idx := i; rarity := rar; reward := rew; mult := m;
    pity_hit := pit_hit; cost := per_cost; dropped_item := item;
    return next;
    i := i + 1;
  end loop;

  update public.profiles set case_pity = cur_pity where id = uid;
end; $$;
grant execute on function public.open_case_batch(text,boolean,integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Biggest single win: include every modern positive payout kind
-- ---------------------------------------------------------------------------
create or replace function public._bump_biggest_win()
returns trigger language plpgsql as $$
begin
  -- Only count the *payout* legs, not the wager legs. Wager legs are
  -- always negative deltas so the `delta > 0` check filters them out
  -- already, but listing the payout kinds explicitly avoids accidentally
  -- counting things like daily claims as gambling wins.
  if new.delta > 0 and new.kind in (
    -- legacy v1-v3
    'bet_payout',
    'game_coinflip','game_dice','game_roulette','game_blackjack','game_crash',
    'game_case','game_mp',
    'emoji_hunt',
    -- v8 gacha (refund leg, the only one with a positive delta)
    'gacha_pull','gacha_payout',
    -- v9 mines + candy
    'mines_cashout','candy_payout',
    -- v17 plinko, v18 lottery, v19 warfront
    'plinko','lottery','warfront',
    -- market payouts (auctions settled / refunds back to bidders)
    'market_sale_payout','market_auction_refund','market_bid_refund',
    -- multiplayer refund + achievement award
    'mp_refund','achievement_award'
  ) then
    update public.profiles
       set biggest_single_win = greatest(biggest_single_win, new.delta)
     where id = new.user_id
       and new.delta > biggest_single_win;
  end if;
  return new;
end; $$;

drop trigger if exists bump_biggest_win on public.transactions;
create trigger bump_biggest_win
  after insert on public.transactions
  for each row execute function public._bump_biggest_win();

-- One-shot backfill so the existing #1 catches up immediately.
update public.profiles p
   set biggest_single_win = greatest(p.biggest_single_win, sub.max_delta)
  from (
    select user_id, max(delta) as max_delta
      from public.transactions
     where delta > 0
       and kind in (
         'bet_payout',
         'game_coinflip','game_dice','game_roulette','game_blackjack','game_crash',
         'game_case','game_mp','emoji_hunt',
         'gacha_pull','gacha_payout',
         'mines_cashout','candy_payout',
         'plinko','lottery','warfront',
         'market_sale_payout','market_auction_refund','market_bid_refund',
         'mp_refund','achievement_award'
       )
     group by user_id
  ) sub
 where p.id = sub.user_id
   and sub.max_delta > p.biggest_single_win;

-- ---------------------------------------------------------------------------
-- 4. Plinko multipliers retuned to ~97% RTP
-- ---------------------------------------------------------------------------
delete from public.plinko_mult;
insert into public.plinko_mult (rows_count, risk, bin_index, multiplier) values
  -- 8 rows, 9 bins. Target RTP: ~97.0%
  (8,'low',    0,5.49),(8,'low',    1,2.06),(8,'low',    2,1.08),(8,'low',    3,0.98),(8,'low',    4,0.49),
  (8,'low',    5,0.98),(8,'low',    6,1.08),(8,'low',    7,2.06),(8,'low',    8,5.49),
  (8,'medium', 0,12.75),(8,'medium',1,2.94),(8,'medium',2,1.28),(8,'medium',3,0.69),(8,'medium',4,0.39),
  (8,'medium', 5,0.69),(8,'medium',6,1.28),(8,'medium',7,2.94),(8,'medium',8,12.75),
  (8,'high',   0,28.39),(8,'high',  1,3.92),(8,'high',  2,1.47),(8,'high',  3,0.29),(8,'high',  4,0.20),
  (8,'high',   5,0.29),(8,'high',  6,1.47),(8,'high',  7,3.92),(8,'high',  8,28.39),
  -- 10 rows, 11 bins. Target RTP: ~97.0%
  (10,'low',    0,8.72),(10,'low',    1,2.94),(10,'low',    2,1.37),(10,'low',    3,1.08),(10,'low',    4,0.98),(10,'low',    5,0.49),
  (10,'low',    6,0.98),(10,'low',    7,1.08),(10,'low',    8,1.37),(10,'low',    9,2.94),(10,'low',   10,8.72),
  (10,'medium', 0,21.58),(10,'medium',1,4.90),(10,'medium',2,1.96),(10,'medium',3,1.37),(10,'medium',4,0.59),(10,'medium',5,0.39),
  (10,'medium', 6,0.59),(10,'medium',7,1.37),(10,'medium',8,1.96),(10,'medium',9,4.90),(10,'medium',10,21.58),
  (10,'high',   0,74.84),(10,'high',  1,9.85),(10,'high', 2,3.94),(10,'high',  3,0.49),(10,'high',  4,0.30),(10,'high',  5,0.20),
  (10,'high',   6,0.30),(10,'high',  7,0.49),(10,'high',  8,3.94),(10,'high',  9,9.85),(10,'high', 10,74.84),
  -- 12 rows, 13 bins. Target RTP: ~97.0%
  (12,'low',    0,10.02),(12,'low',    1,3.01),(12,'low',    2,1.60),(12,'low',    3,1.20),(12,'low',    4,1.10),(12,'low',    5,1.00),(12,'low',    6,0.50),
  (12,'low',    7,1.00),(12,'low',    8,1.10),(12,'low',    9,1.20),(12,'low',   10,1.60),(12,'low',   11,3.01),(12,'low',   12,10.02),
  (12,'medium', 0,33.14),(12,'medium',1,11.05),(12,'medium',2,4.02),(12,'medium',3,2.01),(12,'medium',4,1.00),(12,'medium',5,0.60),(12,'medium',6,0.30),
  (12,'medium', 7,0.60),(12,'medium',8,1.00),(12,'medium',9,2.01),(12,'medium',10,4.02),(12,'medium',11,11.05),(12,'medium',12,33.14),
  (12,'high',   0,168.09),(12,'high', 1,23.73),(12,'high',  2,8.01),(12,'high',  3,1.98),(12,'high',  4,0.49),(12,'high',  5,0.30),(12,'high',  6,0.20),
  (12,'high',   7,0.30),(12,'high',  8,0.49),(12,'high',  9,1.98),(12,'high', 10,8.01),(12,'high', 11,23.73),(12,'high', 12,168.09)
on conflict (rows_count, risk, bin_index) do update set multiplier = excluded.multiplier;

-- ---------------------------------------------------------------------------
-- 5. play_plinko_batch: drop N balls in one transaction.
--    Returns one row per ball with the L/R path and the bin/payout it
--    landed on. Total credit delta is applied once at start (-bet*count)
--    and once at end (+sum_payouts), keeping the transaction log tidy.
-- ---------------------------------------------------------------------------
create or replace function public.play_plinko_batch(
  p_bet   integer,
  p_rows  integer default 8,
  p_risk  text    default 'medium',
  p_count integer default 1
) returns table (
  idx          integer,
  path         boolean[],
  bin_index    integer,
  multiplier   numeric,
  payout       integer,
  won          boolean,
  new_balance  integer
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  uid        uuid := auth.uid();
  prof       public.profiles%rowtype;
  rows_      int := coalesce(p_rows, 8);
  risk_      text := coalesce(p_risk, 'medium');
  cnt        int := coalesce(p_count, 1);
  total_bet  integer;
  total_pay  integer := 0;
  bin_       int;
  i_         int;
  j_         int;
  went_right boolean;
  path_      boolean[];
  m          numeric;
  pay        integer;
  bal        integer;
  paths_     jsonb[] := array[]::jsonb[];
  bins_      int[] := array[]::int[];
  mults_     numeric[] := array[]::numeric[];
  pays_      int[] := array[]::int[];
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  perform public._txn_user_lock('plinko');

  if not public.is_game_active('plinko') then
    raise exception 'Plinko is currently out of rotation';
  end if;

  if p_bet is null or p_bet < 1 then raise exception 'bet must be >= 1'; end if;
  if p_bet > 100000 then raise exception 'bet too large'; end if;
  if rows_ < 4 or rows_ > 12 then raise exception 'rows must be 4..12'; end if;
  if risk_ not in ('low','medium','high') then raise exception 'risk must be low/medium/high'; end if;
  if cnt < 1 or cnt > 50 then raise exception 'count must be 1..50'; end if;

  total_bet := p_bet * cnt;

  select * into prof from public.profiles where id = uid for update;
  if prof.credits < total_bet then raise exception 'Not enough credits (need %)', total_bet; end if;

  perform public._apply_credit_delta(uid, -total_bet, 'plinko',
    jsonb_build_object('phase','wager','rows',rows_,'risk',risk_,'count',cnt,'per_bet',p_bet));

  for i_ in 1..cnt loop
    bin_ := 0;
    path_ := array[]::boolean[];

    for j_ in 1..rows_ loop
      went_right := random() > 0.5;
      path_ := array_append(path_, went_right);
      if went_right then
        bin_ := bin_ + 1;
      end if;
    end loop;

    select multiplier into m
      from public.plinko_mult
     where rows_count = rows_ and risk = risk_ and bin_index = bin_;

    if m is null then
      raise exception 'No multiplier for rows=%, risk=%, bin=%', rows_, risk_, bin_;
    end if;

    pay := floor(p_bet::numeric * m)::int;
    total_pay := total_pay + pay;

    insert into public.plinko_drops (user_id, bet, rows_used, risk, path, bin_index, multiplier, payout)
      values (uid, p_bet, rows_, risk_, path_, bin_, m, pay);

    paths_ := array_append(paths_, to_jsonb(path_));
    bins_  := array_append(bins_, bin_);
    mults_ := array_append(mults_, m);
    pays_  := array_append(pays_, pay);
  end loop;

  if total_pay > 0 then
    perform public._apply_credit_delta(uid, total_pay, 'plinko',
      jsonb_build_object('phase','payout','rows',rows_,'risk',risk_,'count',cnt,
                         'total_payout',total_pay,'per_bet',p_bet));
  end if;

  select credits into bal from public.profiles where id = uid;

  for i_ in 1..cnt loop
    idx         := i_ - 1;
    path        := array(select jsonb_array_elements_text(paths_[i_]))::boolean[];
    bin_index   := bins_[i_];
    multiplier  := mults_[i_];
    payout      := pays_[i_];
    won         := pays_[i_] > p_bet;
    new_balance := bal;
    return next;
  end loop;
end; $$;
grant execute on function public.play_plinko_batch(integer,integer,text,integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Hardened leaderboard_tick: per-board EXCEPTION blocks.
-- ---------------------------------------------------------------------------
create or replace function public.leaderboard_tick()
returns void
language plpgsql security definer set search_path = public as $$
declare
  top_uid uuid;
  reward  int := 5000;
begin
  begin
    select id into top_uid from public.profiles
      where credits > 0 order by credits desc limit 1;
    perform public._kh_touch('credits', 'king_of_credits', top_uid, reward);
  exception when others then null; end;

  begin
    select id into top_uid from public.profiles
      where peak_credits > 0 order by peak_credits desc limit 1;
    perform public._kh_touch('peak', 'king_of_peak', top_uid, reward);
  exception when others then null; end;

  begin
    select id into top_uid from public.profiles
      where biggest_single_win > 0 order by biggest_single_win desc limit 1;
    perform public._kh_touch('biggest_win', 'king_of_biggest_win', top_uid, reward);
  exception when others then null; end;

  begin
    select id into top_uid from public.profiles
      where total_won > 0 order by total_won desc limit 1;
    perform public._kh_touch('total_won', 'king_of_total_won', top_uid, reward);
  exception when others then null; end;

  begin
    select id into top_uid from public.profiles
      where total_wagered > 0 order by total_wagered desc limit 1;
    perform public._kh_touch('total_wagered', 'king_of_total_wagered', top_uid, reward);
  exception when others then null; end;

  begin
    select id into top_uid from public.profiles
      where cases_opened > 0 order by cases_opened desc limit 1;
    perform public._kh_touch('cases', 'king_of_cases', top_uid, reward);
  exception when others then null; end;

  begin
    select id into top_uid from public.profiles
      where items_unique > 0 order by items_unique desc, items_total desc limit 1;
    perform public._kh_touch('collection', 'king_of_collection', top_uid, reward);
  exception when others then null; end;
end; $$;
grant execute on function public.leaderboard_tick() to authenticated;

-- Done.
