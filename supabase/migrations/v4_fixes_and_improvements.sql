-- ============================================================================
-- Migration v4 — Fixes + improvements round 2
--
-- Run after v3. Idempotent, re-runnable.
--
-- Changes:
--   * resolve_event            — no more 5% house fee, pool fully redistributed
--   * play_coinflip            — minimum bet 10 (otherwise 1.95× truncates to 1)
--   * play_dice                — minimum bet enforced per multiplier so
--                                a winning roll is always strictly profitable
--   * open_case                — new rarity "ultra" (100× at 0.05%), buffed
--                                uncommon (1× → 1.5×), fairer key (re-roll on
--                                common instead of renormalise), pity unaffected
--                                by key opens
--   * open_case_batch          — open N cases in one transaction (3/5/10/20/50)
--   * _bj_finalize             — player blackjack always wins 3:2, even when
--                                dealer also has 21 (no more BJ-vs-BJ push)
--   * bj_insurance / bj_start  — keep the win on player-BJ vs dealer-BJ
--   * bj_double                — validates funds cleanly instead of tripping
--                                the profiles_credits_check constraint
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Events: redistribute the whole pool pro-rata. No house fee.
-- ----------------------------------------------------------------------------
create or replace function public.resolve_event(p_event uuid, p_winning_option int)
returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  ev  public.events%rowtype;
  prof public.profiles%rowtype;
  total_pool integer;
  winning_pool integer;
  bet record;
  payout_amt integer;
  distributed integer := 0;
  max_bet_id uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into prof from public.profiles where id = uid;
  select * into ev from public.events where id = p_event for update;
  if not found then raise exception 'Event not found'; end if;
  if ev.resolved_at is not null then raise exception 'Already resolved'; end if;

  -- Only creator OR admin can resolve. Creator can only resolve after close.
  if not prof.is_admin and (ev.creator_id <> uid or now() < ev.closes_at) then
    raise exception 'Not allowed to resolve';
  end if;

  if p_winning_option < 0 or p_winning_option >= array_length(ev.options,1) then
    raise exception 'Invalid option';
  end if;

  select coalesce(sum(amount),0) into total_pool
    from public.event_bets where event_id = p_event;
  select coalesce(sum(amount),0) into winning_pool
    from public.event_bets
    where event_id = p_event and option_idx = p_winning_option;

  if winning_pool = 0 then
    -- Nobody won: refund everyone their wager.
    for bet in select * from public.event_bets where event_id = p_event loop
      perform public._apply_credit_delta(bet.user_id, bet.amount, 'bet_payout',
        jsonb_build_object('event_id',p_event,'refund',true));
      update public.event_bets set payout = bet.amount where id = bet.id;
    end loop;
  else
    -- Winners split the FULL pool pro-rata of their stake in the winning option.
    -- No house fee. Sum of payouts ≤ total_pool because of integer floor;
    -- any rounding remainder is handed to the largest winning bet so the
    -- pot is always exhausted exactly.
    for bet in select * from public.event_bets
                where event_id = p_event and option_idx = p_winning_option
                order by amount desc, id asc
    loop
      payout_amt := floor((bet.amount::numeric / winning_pool) * total_pool)::int;
      if payout_amt > 0 then
        perform public._apply_credit_delta(bet.user_id, payout_amt, 'bet_payout',
          jsonb_build_object('event_id',p_event,'won',true,
            'stake',bet.amount,'winning_pool',winning_pool,'total_pool',total_pool));
      end if;
      update public.event_bets set payout = payout_amt where id = bet.id;
      distributed := distributed + payout_amt;
      if max_bet_id is null then max_bet_id := bet.id; end if;
    end loop;

    -- Absorb rounding drift into the largest winner so sum(payouts)=total_pool.
    if distributed < total_pool and max_bet_id is not null then
      declare
        remainder integer := total_pool - distributed;
        leader_uid uuid;
      begin
        select user_id into leader_uid from public.event_bets where id = max_bet_id;
        perform public._apply_credit_delta(leader_uid, remainder, 'bet_payout',
          jsonb_build_object('event_id',p_event,'remainder',true));
        update public.event_bets
           set payout = payout + remainder
         where id = max_bet_id;
      end;
    end if;

    update public.event_bets set payout = 0
      where event_id = p_event and option_idx <> p_winning_option;
  end if;

  update public.events
     set resolved_at = now(), winning_option = p_winning_option
   where id = p_event;
end; $$;


-- ----------------------------------------------------------------------------
-- 2. Coinflip: minimum bet 10 (so 1.95× is always strictly profitable).
-- ----------------------------------------------------------------------------
create or replace function public.play_coinflip(p_amount integer, p_side text)
returns table(new_balance integer, won boolean, result text, payout integer)
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  flip text;
  win boolean;
  pay integer := 0;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_side not in ('heads','tails') then raise exception 'Invalid side'; end if;
  if p_amount < 10 then raise exception 'Minimum coinflip bet is 10 credits'; end if;
  if p_amount > 10000 then raise exception 'Maximum bet is 10000 credits'; end if;

  perform public._apply_credit_delta(uid, -p_amount, 'game_coinflip',
    jsonb_build_object('phase','wager','side',p_side));

  flip := case when (random() < 0.5) then 'heads' else 'tails' end;
  win := flip = p_side;
  if win then
    pay := (p_amount * 195) / 100;
    perform public._apply_credit_delta(uid, pay, 'game_coinflip',
      jsonb_build_object('phase','win','result',flip));
  else
    perform public._apply_credit_delta(uid, 0, 'game_coinflip',
      jsonb_build_object('phase','loss','result',flip));
  end if;

  return query select p.credits, win, flip, pay from public.profiles p where p.id = uid;
end; $$;


-- ----------------------------------------------------------------------------
-- 3. Dice: enforce a bet that actually pays more than it costs on a win.
--    multiplier = 0.97 / win_chance; bet B wins floor(B*mult). We need
--    floor(B*mult) > B  ⇔  B > 1/(mult - 1).
--    We also hard-floor to 2 credits so mini-bets can't exploit rounding.
-- ----------------------------------------------------------------------------
create or replace function public.play_dice(p_amount integer, p_target integer, p_over boolean)
returns table(new_balance integer, won boolean, roll integer, multiplier numeric, payout integer)
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  r integer;
  win_chance numeric;
  mult numeric;
  min_bet integer;
  win boolean;
  pay integer := 0;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_target < 4 or p_target > 96 then raise exception 'Target out of range (4..96)'; end if;
  if p_amount < 2 then raise exception 'Minimum dice bet is 2 credits'; end if;
  if p_amount > 10000 then raise exception 'Maximum bet is 10000 credits'; end if;

  if p_over then
    win_chance := (100 - p_target)::numeric / 100;
  else
    win_chance := (p_target - 1)::numeric / 100;
  end if;
  if win_chance <= 0 then raise exception 'Impossible bet'; end if;

  mult := round( (0.97 / win_chance)::numeric, 4);
  if mult <= 1 then
    raise exception 'Multiplier too low (%); widen the target range', mult;
  end if;

  min_bet := greatest(2, ceil(1.0 / (mult - 1))::int + 1);
  if p_amount < min_bet then
    raise exception 'At this multiplier (%×), minimum bet is % credits', mult, min_bet;
  end if;

  perform public._apply_credit_delta(uid, -p_amount, 'game_dice',
    jsonb_build_object('phase','wager','target',p_target,'over',p_over));

  r := floor(random()*100)::int + 1;                -- 1..100
  if p_over then win := r > p_target;
  else           win := r < p_target;
  end if;

  if win then
    pay := floor(p_amount * mult)::int;
    perform public._apply_credit_delta(uid, pay, 'game_dice',
      jsonb_build_object('phase','win','roll',r,'mult',mult));
  else
    perform public._apply_credit_delta(uid, 0, 'game_dice',
      jsonb_build_object('phase','loss','roll',r));
  end if;

  return query select p.credits, win, r, mult, pay from public.profiles p where p.id = uid;
end; $$;


-- ----------------------------------------------------------------------------
-- 4. Case opening: add ultra tier, buff uncommon, fair key, safer pity.
--    New odds (non-key):
--       common    60.00%   0.0×    (cumul 0.6000)
--       uncommon  26.00%   1.5×    (cumul 0.8600)
--       rare      10.00%   2.0×    (cumul 0.9600)
--       epic       2.50%   4.0×    (cumul 0.9850)
--       legendary  1.20%  10.0×    (cumul 0.9970)
--       jackpot    0.25%  40.0×    (cumul 0.9995)
--       ultra      0.05% 100.0×    (cumul 1.0000)
--    Nominal RTP ≈ 96 %.
--
--    Pity: any 10 consecutive commons force next *non-key* open to rare.
--    Key opens no longer affect pity counter at all (neither increment
--    nor reset), so buying keys is not a pity trap.
--
--    Key behaviour (1.5× base cost): re-roll once if the first roll comes
--    up common. Fair & simple. No weird renormalisation.
--
--    Reward is paid_cost × mult when the user used a key, and base_cost ×
--    mult otherwise — this makes the key's reward scale with what you paid.
-- ----------------------------------------------------------------------------

create or replace function public.open_case(p_tier text, p_key boolean default false)
returns table(
  new_balance integer, tier text, rarity text, reward integer,
  cost integer, pity integer, pity_popped boolean, key_used boolean,
  multiplier numeric
)
language plpgsql security definer set search_path = public as $$
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
  reward_base integer;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  case p_tier
    when 'bronze' then base_cost := 10;
    when 'silver' then base_cost := 50;
    when 'gold'   then base_cost := 100;
    else raise exception 'Unknown tier %', p_tier;
  end case;

  final_cost := case when p_key then (base_cost * 3) / 2 else base_cost end;

  -- Lock the pity counter.
  select case_pity into cur_pity from public.profiles where id = uid for update;
  if cur_pity is null then cur_pity := 0; end if;

  -- Charge the wager first.
  perform public._apply_credit_delta(uid, -final_cost, 'game_case',
    jsonb_build_object('phase','wager','tier',p_tier,'key',p_key));

  -- Pick rarity. If key is used, re-roll once on a common result.
  r := random();
  rar := public._case_pick_rarity(r);
  if p_key and rar = 'common' then
    r := random();
    rar := public._case_pick_rarity(r);
  end if;

  -- Pity upgrade (non-key path only): bump common → rare when threshold hit.
  if not p_key and rar = 'common' and cur_pity >= 9 then
    rar := 'rare';
    pity_hit := true;
  end if;

  mult := public._case_mult(rar);
  reward_base := case when p_key then final_cost else base_cost end;
  rew := floor(reward_base * mult)::int;

  if rew > 0 then
    perform public._apply_credit_delta(uid, rew, 'game_case',
      jsonb_build_object('phase','reward','tier',p_tier,'rarity',rar,
        'key', p_key, 'pity_hit', pity_hit));
  else
    perform public._apply_credit_delta(uid, 0, 'game_case',
      jsonb_build_object('phase','loss','tier',p_tier,'rarity',rar,
        'key', p_key));
  end if;

  -- Pity accounting: *only* non-key opens touch the counter.
  if not p_key then
    if rar = 'common' then
      cur_pity := cur_pity + 1;
    else
      cur_pity := 0;
    end if;
    update public.profiles set case_pity = cur_pity where id = uid;
  end if;

  insert into public.case_openings (user_id, tier, cost, rarity, reward, key_used, pity_popped)
    values (uid, p_tier, final_cost, rar, rew, p_key, pity_hit);

  return query
    select p.credits, p_tier, rar, rew, final_cost, cur_pity, pity_hit, p_key, mult
      from public.profiles p where p.id = uid;
end; $$;
grant execute on function public.open_case(text, boolean) to authenticated;


-- Helper: rarity thresholds (cumulative distribution).
create or replace function public._case_pick_rarity(r numeric)
returns text
language plpgsql immutable as $$
begin
  if    r < 0.6000 then return 'common';
  elsif r < 0.8600 then return 'uncommon';
  elsif r < 0.9600 then return 'rare';
  elsif r < 0.9850 then return 'epic';
  elsif r < 0.9970 then return 'legendary';
  elsif r < 0.9995 then return 'jackpot';
  else                  return 'ultra';
  end if;
end; $$;

create or replace function public._case_mult(rarity text)
returns numeric
language sql immutable as $$
  select case rarity
    when 'common'    then 0.0
    when 'uncommon'  then 1.5
    when 'rare'      then 2.0
    when 'epic'      then 4.0
    when 'legendary' then 10.0
    when 'jackpot'   then 40.0
    when 'ultra'     then 100.0
    else 0.0
  end;
$$;


-- ----------------------------------------------------------------------------
-- 4b. open_case_batch — open N cases atomically (N in {3,5,10,20,50}).
--     Charges cost*N upfront, rolls each independently, returns all results
--     as a set so the client can render all reveals at once.
--     Pity counter is respected and updated across the batch.
-- ----------------------------------------------------------------------------
create or replace function public.open_case_batch(
  p_tier text, p_key boolean, p_count integer
) returns table(
  idx integer, rarity text, reward integer, mult numeric,
  pity_hit boolean, cost integer
)
language plpgsql security definer set search_path = public as $$
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
  reward_base integer;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_count not in (3,5,10,20,50) then raise exception 'Batch size must be 3/5/10/20/50'; end if;

  case p_tier
    when 'bronze' then base_cost := 10;
    when 'silver' then base_cost := 50;
    when 'gold'   then base_cost := 100;
    else raise exception 'Unknown tier %', p_tier;
  end case;
  per_cost := case when p_key then (base_cost * 3) / 2 else base_cost end;
  total_cost := per_cost * p_count;

  -- One bulk wager so the balance moves in a single ledger entry.
  perform public._apply_credit_delta(uid, -total_cost, 'game_case',
    jsonb_build_object('phase','wager','tier',p_tier,'key',p_key,
      'batch_count', p_count, 'per_cost', per_cost));

  -- Lock pity counter once for the whole batch.
  select case_pity into cur_pity from public.profiles where id = uid for update;
  if cur_pity is null then cur_pity := 0; end if;
  reward_base := case when p_key then per_cost else base_cost end;

  while i < p_count loop
    r := random();
    rar := public._case_pick_rarity(r);
    if p_key and rar = 'common' then
      r := random();
      rar := public._case_pick_rarity(r);
    end if;
    pit_hit := false;
    if not p_key and rar = 'common' and cur_pity >= 9 then
      rar := 'rare';
      pit_hit := true;
    end if;

    m := public._case_mult(rar);
    rew := floor(reward_base * m)::int;

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

    idx := i; rarity := rar; reward := rew; mult := m;
    pity_hit := pit_hit; cost := per_cost;
    return next;

    i := i + 1;
  end loop;

  update public.profiles set case_pity = cur_pity where id = uid;
end; $$;
grant execute on function public.open_case_batch(text,boolean,integer) to authenticated;


-- ----------------------------------------------------------------------------
-- 5. Blackjack: player blackjack ALWAYS wins (3:2), even versus dealer BJ.
-- ----------------------------------------------------------------------------
create or replace function public._bj_finalize(p_hand_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  h public.blackjack_hands%rowtype;
  dt int; pt int;
  any_alive boolean := false;
  e jsonb;
  arr jsonb := '[]'::jsonb;
  bet_amt int;
  pcards int[];
  payout int;
  result text;
  is_bj bool;
  i int := 0;
  tot_payout int := 0;
begin
  select * into h from public.blackjack_hands where id = p_hand_id for update;
  if not found then return; end if;
  if h.status = 'done' then return; end if;

  for e in select value from jsonb_array_elements(h.hands) loop
    pcards := array(select (jsonb_array_elements_text(e->'cards'))::int);
    if not coalesce((e->>'surrendered')::bool, false)
       and not coalesce((e->>'blackjack')::bool, false)
       and public.bj_hand_total(pcards) <= 21 then
      any_alive := true;
      exit;
    end if;
  end loop;

  if any_alive then
    dt := public.bj_hand_total(h.dealer_cards);
    while dt < 17 loop
      h.dealer_cards := h.dealer_cards || h.deck[1];
      h.deck := h.deck[2:];
      dt := public.bj_hand_total(h.dealer_cards);
    end loop;
  else
    dt := public.bj_hand_total(h.dealer_cards);
  end if;

  for e in select value from jsonb_array_elements(h.hands) loop
    bet_amt := (e->>'bet')::int;
    pcards  := array(select (jsonb_array_elements_text(e->'cards'))::int);
    pt      := public.bj_hand_total(pcards);
    is_bj   := coalesce((e->>'blackjack')::bool, false);
    payout  := 0;

    if coalesce((e->>'surrendered')::bool, false) then
      result := 'surrender'; payout := bet_amt / 2;
    elsif is_bj then
      -- Player blackjack ALWAYS wins 3:2. Dealer BJ does not push.
      result := 'blackjack'; payout := (bet_amt * 5) / 2;
    elsif pt > 21 then
      result := 'bust'; payout := 0;
    elsif dt > 21 or pt > dt then
      result := 'win'; payout := bet_amt * 2;
    elsif pt = dt then
      result := 'push'; payout := bet_amt;
    else
      result := 'lose'; payout := 0;
    end if;

    if payout > 0 then
      perform public._apply_credit_delta(h.user_id, payout, 'game_blackjack',
        jsonb_build_object('phase','payout','hand',i,'result',result,'pt',pt,'dt',dt));
    else
      perform public._apply_credit_delta(h.user_id, 0, 'game_blackjack',
        jsonb_build_object('phase','loss','hand',i,'result',result,'pt',pt,'dt',dt));
    end if;
    tot_payout := tot_payout + payout;

    arr := arr || jsonb_build_array(jsonb_build_object(
      'cards',       e->'cards',
      'bet',         bet_amt,
      'doubled',     coalesce((e->>'doubled')::bool,false),
      'surrendered', coalesce((e->>'surrendered')::bool,false),
      'blackjack',   is_bj,
      'done',        true,
      'total',       pt,
      'result',      result,
      'payout',      payout
    ));
    i := i + 1;
  end loop;

  update public.blackjack_hands
     set hands           = arr,
         dealer_cards    = h.dealer_cards,
         deck            = h.deck,
         status          = 'done',
         outcome_summary = jsonb_build_object('dealer_total', dt, 'total_payout', tot_payout),
         resolved_at     = now()
   where id = h.id;
end; $$;


-- ----------------------------------------------------------------------------
-- 6. Blackjack double-down: validate funds first so we never hit the
--    profiles_credits_check constraint mid-RPC (which used to leak a
--    raw Postgres error to the client).
-- ----------------------------------------------------------------------------
create or replace function public.bj_double(p_hand_id uuid)
returns setof public.blackjack_hands
language plpgsql security definer set search_path = public as $$
declare
  h public.blackjack_hands%rowtype;
  hand jsonb; cards int[]; new_card int; bet_amt int; pt int;
  cur_credits integer;
  arr jsonb := '[]'::jsonb; e jsonb; i int := 0;
begin
  select * into h from public.blackjack_hands where id = p_hand_id for update;
  if not found or h.user_id <> auth.uid() then raise exception 'Hand not found'; end if;
  if h.status <> 'active' then raise exception 'Hand not active'; end if;

  hand := h.hands -> h.active_hand;
  cards := array(select (jsonb_array_elements_text(hand->'cards'))::int);
  if array_length(cards,1) <> 2 then raise exception 'Can only double on first 2 cards'; end if;
  bet_amt := (hand->>'bet')::int;

  select credits into cur_credits from public.profiles where id = h.user_id for update;
  if cur_credits is null or cur_credits < bet_amt then
    raise exception 'Not enough credits to double';
  end if;

  perform public._apply_credit_delta(h.user_id, -bet_amt, 'game_blackjack',
    jsonb_build_object('phase','double','hand',h.active_hand));

  new_card := h.deck[1];
  cards := cards || new_card;
  pt := public.bj_hand_total(cards);

  for e in select value from jsonb_array_elements(h.hands) loop
    if i = h.active_hand then
      e := jsonb_set(e, '{cards}',  to_jsonb(cards));
      e := jsonb_set(e, '{bet}',    to_jsonb(bet_amt * 2));
      e := jsonb_set(e, '{doubled}','true'::jsonb);
      e := jsonb_set(e, '{done}',   'true'::jsonb);
    end if;
    arr := arr || jsonb_build_array(e);
    i := i + 1;
  end loop;

  update public.blackjack_hands set hands = arr, deck = h.deck[2:] where id = h.id;
  perform public._bj_advance(h.id);
  return query select * from public.blackjack_hands where id = h.id;
end; $$;


-- Same fix for split: validate funds before deducting.
create or replace function public.bj_split(p_hand_id uuid)
returns setof public.blackjack_hands
language plpgsql security definer set search_path = public as $$
declare
  h public.blackjack_hands%rowtype;
  hand jsonb; cards int[]; r1 int; r2 int; bet_amt int;
  c1 int; c2 int; nc1 int; nc2 int;
  is_aces bool;
  hand1 jsonb; hand2 jsonb;
  cur_credits integer;
begin
  select * into h from public.blackjack_hands where id = p_hand_id for update;
  if not found or h.user_id <> auth.uid() then raise exception 'Hand not found'; end if;
  if h.status <> 'active' then raise exception 'Hand not active'; end if;
  if jsonb_array_length(h.hands) <> 1 then raise exception 'Already split'; end if;

  hand := h.hands -> 0;
  cards := array(select (jsonb_array_elements_text(hand->'cards'))::int);
  if array_length(cards,1) <> 2 then raise exception 'Can only split on first 2 cards'; end if;

  r1 := public.bj_card_rank(cards[1]);
  r2 := public.bj_card_rank(cards[2]);
  if not (r1 = r2 or (r1 >= 10 and r2 >= 10)) then
    raise exception 'Cards must be the same rank to split';
  end if;

  bet_amt := (hand->>'bet')::int;
  select credits into cur_credits from public.profiles where id = h.user_id for update;
  if cur_credits is null or cur_credits < bet_amt then
    raise exception 'Not enough credits to split';
  end if;
  perform public._apply_credit_delta(h.user_id, -bet_amt, 'game_blackjack',
    jsonb_build_object('phase','split','hand_id',h.id));

  c1 := cards[1]; c2 := cards[2];
  nc1 := h.deck[1]; nc2 := h.deck[2];
  is_aces := r1 = 1;

  hand1 := jsonb_build_object(
    'cards',       to_jsonb(array[c1, nc1]),
    'bet',         bet_amt,
    'doubled',     false,
    'done',        is_aces or public.bj_hand_total(array[c1,nc1]) >= 21,
    'surrendered', false,
    'blackjack',   false
  );
  hand2 := jsonb_build_object(
    'cards',       to_jsonb(array[c2, nc2]),
    'bet',         bet_amt,
    'doubled',     false,
    'done',        is_aces or public.bj_hand_total(array[c2,nc2]) >= 21,
    'surrendered', false,
    'blackjack',   false
  );

  update public.blackjack_hands
     set hands       = jsonb_build_array(hand1, hand2),
         deck        = h.deck[3:],
         active_hand = 0
   where id = h.id;

  if (hand1->>'done')::bool then
    perform public._bj_advance(h.id);
  end if;
  return query select * from public.blackjack_hands where id = h.id;
end; $$;

-- Done.
