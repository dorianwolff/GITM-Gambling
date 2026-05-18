-- v27_cases_plinko_rusher_fixes.sql
-- 1. Fix _case_maybe_drop_item: rename local var 'item_id' → 'v_item_id'
--    to eliminate "column reference item_id is ambiguous" that fired
--    ~2% of the time when the item-drop code path was reached.
-- 2. Plinko: server-side path generation for batch mode.
--    play_plinko_batch now runs _plinko_spin N times, stores the computed
--    bins in server_bins, and returns the full per-ball L/R paths to the
--    client so its animation follows the exact same outcome.
--    settle_plinko_batch ignores the (now unused) p_bins arg and uses the
--    stored server_bins — what the player sees and what they get are identical.
-- 3. Plinko multipliers recalculated for ~93% RTP (was ~97%).

-- ── 1. Fix _case_maybe_drop_item ─────────────────────────────────────────────

create or replace function public._case_maybe_drop_item(
  p_user uuid, p_rarity text, p_key boolean
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  drop_chance numeric := case when p_key then 0.03 else 0.02 end;
  v_item_id   uuid;
begin
  if random() >= drop_chance then return null; end if;

  select id into v_item_id
    from public.market_items
   where source = 'case_drop' and rarity = p_rarity
   order by random() limit 1;

  if v_item_id is null then return null; end if;

  insert into public.user_items (user_id, item_id, qty)
    values (p_user, v_item_id, 1)
    on conflict (user_id, item_id) do update
      set qty = user_items.qty + 1;

  return v_item_id;
end; $$;

-- ── 2. Plinko batch: server-side path generation ──────────────────────────────

-- Add column to store server-generated bins (idempotent).
alter table public.plinko_batches
  add column if not exists server_bins int[] default null;

-- play_plinko_batch: deduct bet, generate N paths server-side, return paths to
-- client so its animation can follow the exact L/R sequence the server decided.
-- Returns one row: (batch_id, new_balance, paths).
-- paths is a JSONB array of boolean arrays: [[true,false,...], [false,true,...], ...]
drop function if exists public.play_plinko_batch(integer, integer, text, integer);

create or replace function public.play_plinko_batch(
  p_bet   integer,
  p_rows  integer default 8,
  p_risk  text    default 'medium',
  p_count integer default 1
) returns table (
  batch_id     uuid,
  new_balance  integer,
  paths        jsonb     -- per-ball L/R sequences for the client animation
)
language plpgsql security definer set search_path = public as $$
declare
  uid        uuid := auth.uid();
  prof       public.profiles%rowtype;
  rows_      int  := coalesce(p_rows, 8);
  risk_      text := coalesce(p_risk, 'medium');
  cnt        int  := coalesce(p_count, 1);
  total_bet  integer;
  batch_     uuid;
  v_bins     int[]  := '{}';
  v_paths    jsonb  := '[]'::jsonb;
  v_spin     record;
  i_         int;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  perform public._txn_user_lock('plinko');

  if not public.is_game_active('plinko') then
    raise exception 'Plinko is currently out of rotation';
  end if;
  if p_bet is null or p_bet < 1  then raise exception 'bet must be >= 1'; end if;
  if p_bet > 100000              then raise exception 'bet too large'; end if;
  if rows_ < 4 or rows_ > 12    then raise exception 'rows must be 4..12'; end if;
  if risk_ not in ('low','medium','high') then raise exception 'risk must be low/medium/high'; end if;
  if cnt < 1 or cnt > 50         then raise exception 'count must be 1..50'; end if;

  total_bet := p_bet * cnt;
  select * into prof from public.profiles where id = uid for update;
  if prof.credits < total_bet then
    raise exception 'Not enough credits (need %)', total_bet;
  end if;

  perform public._apply_credit_delta(uid, -total_bet, 'plinko',
    jsonb_build_object('phase','wager','rows',rows_,'risk',risk_,'count',cnt,'per_bet',p_bet));

  -- Generate N outcomes server-side; collect bins + paths.
  for i_ in 1..cnt loop
    select * into v_spin from public._plinko_spin(rows_, risk_);
    v_bins  := array_append(v_bins, v_spin.bin_index);
    v_paths := v_paths || jsonb_build_array(to_jsonb(v_spin.path));
  end loop;

  insert into public.plinko_batches
    (user_id, bet, rows_used, risk, count, total_bet, server_bins)
    values (uid, p_bet, rows_, risk_, cnt, total_bet, v_bins)
    returning id into batch_;

  select credits into new_balance from public.profiles where id = uid;
  return query select batch_, new_balance, v_paths;
end; $$;

grant execute on function public.play_plinko_batch(integer, integer, text, integer) to authenticated;

-- settle_plinko_batch: use stored server_bins; p_bins kept for API compat but ignored.
drop function if exists public.settle_plinko_batch(uuid, int[]);

create or replace function public.settle_plinko_batch(
  p_batch_id uuid,
  p_bins     int[]   -- kept for API compatibility; value is ignored
) returns table (
  idx          integer,
  bin_index    integer,
  multiplier   numeric,
  payout       integer,
  won          boolean,
  new_balance  integer
)
language plpgsql security definer set search_path = public as $$
declare
  uid        uuid := auth.uid();
  batch      public.plinko_batches%rowtype;
  i_         int;
  bin_       int;
  mult_      numeric;
  pay_       integer;
  total_pay  integer := 0;
  mults_     numeric[] := '{}';
  pays_      int[]    := '{}';
  bal        integer;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_batch_id is null then raise exception 'batch id is required'; end if;

  select * into batch
    from public.plinko_batches
   where id = p_batch_id and user_id = uid
   for update;
  if not found then raise exception 'Batch not found'; end if;
  if batch.status <> 'pending' then raise exception 'Batch already settled'; end if;
  if batch.server_bins is null or array_length(batch.server_bins, 1) <> batch.count then
    raise exception 'Server bins missing or count mismatch';
  end if;

  for i_ in 1..batch.count loop
    bin_  := batch.server_bins[i_];
    mult_ := public.plinko_multiplier_for_bin(batch.rows_used, batch.risk, bin_);
    if mult_ is null then
      raise exception 'No multiplier for rows=%, risk=%, bin=%', batch.rows_used, batch.risk, bin_;
    end if;
    pay_      := floor(batch.bet::numeric * mult_)::int;
    total_pay := total_pay + pay_;
    mults_    := array_append(mults_, mult_);
    pays_     := array_append(pays_,  pay_);

    insert into public.plinko_drops
      (user_id, bet, rows_used, risk, path, bin_index, multiplier, payout, landed_bin)
      values (uid, batch.bet, batch.rows_used, batch.risk,
              array[]::boolean[], bin_, mult_, pay_, bin_);
  end loop;

  if total_pay > 0 then
    perform public._apply_credit_delta(uid, total_pay, 'plinko',
      jsonb_build_object('phase','payout','rows',batch.rows_used,'risk',batch.risk,
        'count',batch.count,'total_payout',total_pay,'batch_id',p_batch_id));
  end if;

  update public.plinko_batches
     set settled_bins = batch.server_bins,
         payout       = total_pay,
         status       = 'settled',
         settled_at   = now()
   where id = p_batch_id;

  select credits into bal from public.profiles where id = uid;
  for i_ in 1..batch.count loop
    idx         := i_ - 1;
    bin_index   := batch.server_bins[i_];
    multiplier  := mults_[i_];
    payout      := pays_[i_];
    won         := pays_[i_] > batch.bet;
    new_balance := bal;
    return next;
  end loop;
end; $$;

grant execute on function public.settle_plinko_batch(uuid, int[]) to authenticated;

-- ── 3. Plinko multipliers: ~93% RTP (was ~97%) ───────────────────────────────
-- Verified: sum(C(n,k) * mult[k]) / 2^n ≈ 0.93 for all row×risk combos.

delete from public.plinko_mult;
insert into public.plinko_mult (rows_count, risk, bin_index, multiplier) values
  -- 8 rows / 9 bins — target RTP ≈ 93.0%
  (8,'low',    0,5.25),(8,'low',    1,1.97),(8,'low',    2,1.03),(8,'low',    3,0.94),(8,'low',    4,0.47),
  (8,'low',    5,0.94),(8,'low',    6,1.03),(8,'low',    7,1.97),(8,'low',    8,5.25),
  (8,'medium', 0,12.25),(8,'medium',1,2.82),(8,'medium',2,1.23),(8,'medium',3,0.66),(8,'medium',4,0.37),
  (8,'medium', 5,0.66),(8,'medium',6,1.23),(8,'medium',7,2.82),(8,'medium',8,12.25),
  (8,'high',   0,27.3),(8,'high',  1,3.76),(8,'high',  2,1.41),(8,'high',  3,0.28),(8,'high',  4,0.19),
  (8,'high',   5,0.28),(8,'high',  6,1.41),(8,'high',  7,3.76),(8,'high',  8,27.3),
  -- 10 rows / 11 bins — target RTP ≈ 92.9%
  (10,'low',    0,8.34),(10,'low',    1,2.81),(10,'low',    2,1.31),(10,'low',    3,1.03),(10,'low',    4,0.94),(10,'low',    5,0.47),
  (10,'low',    6,0.94),(10,'low',    7,1.03),(10,'low',    8,1.31),(10,'low',    9,2.81),(10,'low',   10,8.34),
  (10,'medium', 0,20.7),(10,'medium',1,4.71),(10,'medium',2,1.88),(10,'medium',3,1.31),(10,'medium',4,0.57),(10,'medium',5,0.37),
  (10,'medium', 6,0.57),(10,'medium',7,1.31),(10,'medium',8,1.88),(10,'medium',9,4.71),(10,'medium',10,20.7),
  (10,'high',   0,71.6),(10,'high',  1,9.43),(10,'high', 2,3.77),(10,'high',  3,0.47),(10,'high',  4,0.29),(10,'high',  5,0.19),
  (10,'high',   6,0.29),(10,'high',  7,0.47),(10,'high',  8,3.77),(10,'high',  9,9.43),(10,'high', 10,71.6),
  -- 12 rows / 13 bins — target RTP ≈ 93.1%
  (12,'low',    0,9.62),(12,'low',    1,2.89),(12,'low',    2,1.54),(12,'low',    3,1.15),(12,'low',    4,1.06),(12,'low',    5,0.96),(12,'low',    6,0.48),
  (12,'low',    7,0.96),(12,'low',    8,1.06),(12,'low',    9,1.15),(12,'low',   10,1.54),(12,'low',   11,2.89),(12,'low',   12,9.62),
  (12,'medium', 0,31.85),(12,'medium',1,10.62),(12,'medium',2,3.86),(12,'medium',3,1.93),(12,'medium',4,0.96),(12,'medium',5,0.58),(12,'medium',6,0.29),
  (12,'medium', 7,0.58),(12,'medium',8,0.96),(12,'medium',9,1.93),(12,'medium',10,3.86),(12,'medium',11,10.62),(12,'medium',12,31.85),
  (12,'high',   0,160.9),(12,'high', 1,22.71),(12,'high',  2,7.67),(12,'high',  3,1.90),(12,'high',  4,0.47),(12,'high',  5,0.29),(12,'high',  6,0.19),
  (12,'high',   7,0.29),(12,'high',  8,0.47),(12,'high',  9,1.90),(12,'high', 10,7.67),(12,'high', 11,22.71),(12,'high', 12,160.9)
on conflict (rows_count, risk, bin_index) do update set multiplier = excluded.multiplier;
