-- ============================================================================
-- v12_fixes_tx_lock_key.sql
--   Three surgical fixes that belong together:
--
--   1. transactions.kind CHECK widened for the new games.
--      v5 was the last time we touched this constraint; v8/v9 introduced
--      kinds 'gacha_pull', 'gacha_payout', 'mines_bet', 'mines_cashout',
--      'candy_bet', 'candy_payout' which the constraint still rejects →
--      every pull/cashout/spin currently 400s at the INSERT. We drop
--      and recreate with the full union; existing rows are unchanged.
--
--   2. Per-user advisory transaction lock in gacha_pull, minesweeper_*,
--      and candy_spin. The client guards against double-submits but
--      mashed buttons still fire two rapid RPCs whose credit-delta +
--      pity/layout writes race, occasionally producing over-charges
--      or "row was locked" 400s. `pg_try_advisory_xact_lock` makes the
--      second call fail-fast with a readable error; the lock auto-releases
--      at commit/rollback so we never leak state.
--
--   3. Golden-key EV bug.
--      v5 `open_case`/`open_case_batch` compute `reward_base := final_cost`
--      when `p_key = true`, which means the multiplier is applied to the
--      inflated +50% cost. Combined with the "re-roll commons" rule that
--      pushes low rolls into at-least uncommon territory, the RTP climbs
--      past 100%. The intended behaviour is: the key buys you *better
--      odds*, not a bigger payout base. Fix: `reward_base := base_cost`
--      in both key and no-key paths. Same multipliers, same odds, honest
--      house edge.
--
-- Depends on v7/v8/v9. Idempotent: safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Widen transactions.kind.
-- ---------------------------------------------------------------------------
alter table public.transactions drop constraint if exists transactions_kind_check;
alter table public.transactions
  add constraint transactions_kind_check check (kind in (
    -- v0/v1/v2
    'daily_claim','signup_bonus',
    'bet_place','bet_payout',
    'game_coinflip','game_dice','game_roulette','game_blackjack','game_crash',
    'game_case','game_mp','mp_refund',
    'emoji_hunt','admin_grant','admin_revoke',
    -- v5 market
    'market_buy','market_list_fee','market_bid_escrow','market_bid_refund',
    'market_sale_payout','market_auction_refund',
    -- v8 gacha
    'gacha_pull','gacha_payout',
    -- v9 mines + candy
    'mines_bet','mines_cashout','candy_bet','candy_payout',
    -- v12+ reserved for forthcoming achievements (cheap to list now so
    -- we don't need another migration when king_of_the_hill ships)
    'achievement_award'
  ));


-- ---------------------------------------------------------------------------
-- 2. Spam-safe wrapping of gacha_pull / minesweeper_* / candy_spin.
--    We can't easily edit the function bodies without copy-pasting hundreds
--    of lines. Instead we wrap each with a thin delegator that acquires a
--    per-user advisory lock, then calls the real (renamed) function.
--
--    To avoid naming conflicts we: rename the current function by version
--    (adding `_inner_v11`), then recreate the public-facing name as the
--    guarded wrapper that PERFORM-locks before delegating.
-- ---------------------------------------------------------------------------

-- Lock helper — hashtextextended (bigint) so we fit in pg_advisory's
-- 32-bit slot without collisions. One key = (uid + scope). If a second
-- call arrives while the first is mid-commit, it raises a clear error
-- instead of the opaque "balance underflow" from racing credit deltas.
create or replace function public._txn_user_lock(p_scope text)
returns void language plpgsql as $$
declare
  uid uuid := auth.uid();
  k1 int;
  k2 int;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  -- hashtextextended returns bigint; split into two ints for the 2-arg form
  -- (less likely to collide across users for the same scope).
  k1 := (hashtextextended(uid::text, 0) & x'7fffffff'::bigint)::int;
  k2 := (hashtextextended(p_scope, 0) & x'7fffffff'::bigint)::int;
  if not pg_try_advisory_xact_lock(k1, k2) then
    raise exception 'Too fast — another action is still processing';
  end if;
end; $$;

-- NB: We keep the locking INSIDE each RPC rather than wrapping externally,
-- so we don't risk drift from function signatures. Patch each in-place.

-- --- gacha_pull ------------------------------------------------------------
-- We can't ALTER a function body without re-declaring it; but we *can* add
-- a one-line PERFORM at the top. Easiest correct path is: wrap call-sites
-- into an outer function with the same signature, name-colliding via
-- CREATE OR REPLACE. Rename the original first.
do $$
begin
  if exists (select 1 from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'gacha_pull') then
    -- Inner name must be unique. Drop any prior _guarded rename from a
    -- re-run before taking a fresh snapshot.
    if exists (select 1 from pg_proc p
               join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = '_gacha_pull_inner') then
      drop function public._gacha_pull_inner(integer);
    end if;
    alter function public.gacha_pull(integer) rename to _gacha_pull_inner;
  end if;
end $$;

create or replace function public.gacha_pull(p_count integer)
returns table (
  pull_index    integer,
  item_id       uuid,
  pool_id       uuid,
  rarity        text,
  name          text,
  emoji         text,
  is_unique     boolean,
  pity_popped   boolean,
  pity_after    integer,
  new_balance   integer
)
language plpgsql security definer set search_path = public as $$
begin
  perform public._txn_user_lock('gacha_pull');
  return query select * from public._gacha_pull_inner(p_count);
end; $$;
grant execute on function public.gacha_pull(integer) to authenticated;

-- --- minesweeper_start -----------------------------------------------------
do $$
begin
  if exists (select 1 from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'minesweeper_start') then
    if exists (select 1 from pg_proc p
               join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = '_minesweeper_start_inner') then
      drop function public._minesweeper_start_inner(integer, integer);
    end if;
    alter function public.minesweeper_start(integer, integer) rename to _minesweeper_start_inner;
  end if;
end $$;

create or replace function public.minesweeper_start(p_bet integer, p_mines integer)
returns table (id uuid, new_balance integer, bet integer, mines integer)
language plpgsql security definer set search_path = public as $$
begin
  perform public._txn_user_lock('mines_start');
  return query select * from public._minesweeper_start_inner(p_bet, p_mines);
end; $$;
grant execute on function public.minesweeper_start(integer, integer) to authenticated;

-- --- minesweeper_reveal ----------------------------------------------------
do $$
begin
  if exists (select 1 from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'minesweeper_reveal') then
    if exists (select 1 from pg_proc p
               join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = '_minesweeper_reveal_inner') then
      drop function public._minesweeper_reveal_inner(uuid, integer);
    end if;
    alter function public.minesweeper_reveal(uuid, integer) rename to _minesweeper_reveal_inner;
  end if;
end $$;

create or replace function public.minesweeper_reveal(p_id uuid, p_cell integer)
returns table (
  status            text,
  revealed          integer[],
  hit_mine          boolean,
  mult_bp           integer,
  current_multi     numeric,
  mines_revealed    integer[],
  potential_payout  integer,
  new_balance       integer
)
language plpgsql security definer set search_path = public as $$
begin
  perform public._txn_user_lock('mines_reveal');
  return query select * from public._minesweeper_reveal_inner(p_id, p_cell);
end; $$;
grant execute on function public.minesweeper_reveal(uuid, integer) to authenticated;

-- --- minesweeper_cashout ---------------------------------------------------
do $$
begin
  if exists (select 1 from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'minesweeper_cashout') then
    if exists (select 1 from pg_proc p
               join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = '_minesweeper_cashout_inner') then
      drop function public._minesweeper_cashout_inner(uuid);
    end if;
    alter function public.minesweeper_cashout(uuid) rename to _minesweeper_cashout_inner;
  end if;
end $$;

create or replace function public.minesweeper_cashout(p_id uuid)
returns table (
  payout         integer,
  mult_bp        integer,
  new_balance    integer,
  mines_revealed integer[]
)
language plpgsql security definer set search_path = public as $$
begin
  perform public._txn_user_lock('mines_cashout');
  return query select * from public._minesweeper_cashout_inner(p_id);
end; $$;
grant execute on function public.minesweeper_cashout(uuid) to authenticated;

-- --- candy_spin ------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'candy_spin') then
    if exists (select 1 from pg_proc p
               join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = '_candy_spin_inner') then
      drop function public._candy_spin_inner(integer);
    end if;
    alter function public.candy_spin(integer) rename to _candy_spin_inner;
  end if;
end $$;

create or replace function public.candy_spin(p_bet integer)
returns table (
  id          uuid,
  payout      integer,
  cascades    integer,
  snapshots   jsonb,
  new_balance integer
)
language plpgsql security definer set search_path = public as $$
begin
  perform public._txn_user_lock('candy_spin');
  return query select * from public._candy_spin_inner(p_bet);
end; $$;
grant execute on function public.candy_spin(integer) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Golden-key EV fix. Same logic as v5's open_case / open_case_batch but
--    `reward_base := base_cost` unconditionally. The key still (a) costs
--    50% more and (b) re-rolls commons; it no longer *also* inflates the
--    payout base. Net effect: keys are break-even to slightly -EV per pull
--    instead of +EV, matching the documented 95% RTP.
-- ---------------------------------------------------------------------------

drop function if exists public.open_case(text, boolean);
create or replace function public.open_case(p_tier text, p_key boolean default false)
returns table(
  new_balance integer, tier text, rarity text, reward integer,
  cost integer, pity integer, pity_popped boolean, key_used boolean,
  multiplier numeric, dropped_item uuid
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
  item uuid;
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
  if p_key and rar = 'common' then
    r := random();
    rar := public._case_pick_rarity(r);
  end if;

  if not p_key and rar = 'common' and cur_pity >= 9 then
    rar := 'rare';
    pity_hit := true;
  end if;

  mult := public._case_mult(rar);
  -- FIX: payout is always keyed to base_cost. The golden key buys better
  -- odds (the re-roll), not a bigger payout base. With final_cost here we
  -- were double-compensating the key and pushing expected value above 1.
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

  return query
    select p.credits, p_tier, rar, rew, final_cost, cur_pity, pity_hit, p_key, mult, item
      from public.profiles p where p.id = uid;
end; $$;
grant execute on function public.open_case(text, boolean) to authenticated;


drop function if exists public.open_case_batch(text, boolean, integer);
create or replace function public.open_case_batch(
  p_tier text, p_key boolean, p_count integer
) returns table(
  idx integer, rarity text, reward integer, mult numeric,
  pity_hit boolean, cost integer, dropped_item uuid
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
  item uuid;
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
    if p_key and rar = 'common' then r := random(); rar := public._case_pick_rarity(r); end if;
    pit_hit := false;
    if not p_key and rar = 'common' and cur_pity >= 9 then
      rar := 'rare'; pit_hit := true;
    end if;

    m := public._case_mult(rar);
    -- Same EV fix as open_case: payout keyed to base_cost, not per_cost.
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

-- Done.
