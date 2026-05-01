-- ============================================================================
-- v17_plinko.sql
--   Plinko — drop a ball through a peg board and land in a multiplier slot.
--   Server-resolved with atomic credit delta.
--
--   Board: 8 rows of pegs → 9 landing bins at the bottom.
--   Each drop is a random walk: left/right at each peg.
--   Multipliers follow a normal-ish bell curve: 0.2× centre, up to 10× edges.
--
--   Depends on: v12 (transactions.kind 'plinko' pre-reserved), v13 (rotation).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. History table
-- ---------------------------------------------------------------------------
create table if not exists public.plinko_drops (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  bet         integer not null check (bet > 0),
  rows_used   int not null default 8 check (rows_used between 4 and 12),
  risk        text not null check (risk in ('low','medium','high')) default 'medium',
  path        boolean[] not null,          -- true = right, false = left
  bin_index   int not null check (bin_index >= 0),
  multiplier  numeric not null,
  payout      integer not null,
  created_at  timestamptz not null default now()
);

create index if not exists plinko_drops_user_idx on public.plinko_drops (user_id, created_at desc);

alter table public.plinko_drops enable row level security;

drop policy if exists "plinko read own" on public.plinko_drops;
create policy "plinko read own" on public.plinko_drops
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 2. Multiplier tables (one per risk level)
--    8 rows → 9 bins.  Centred around bin 4.  RTP targets ~96 %.
-- ---------------------------------------------------------------------------
create table if not exists public.plinko_mult (
  rows_count int not null check (rows_count between 4 and 12),
  risk       text not null check (risk in ('low','medium','high')),
  bin_index  int not null,
  multiplier numeric not null,
  primary key (rows_count, risk, bin_index)
);

-- Seed 8-row, 10-row and 12-row tables.  Centre = lowest mult, edges = highest.
insert into public.plinko_mult (rows_count, risk, bin_index, multiplier)
values
  -- 8 rows (9 bins)
  (8, 'low',    0, 2.0),  (8, 'low',    1, 1.5),  (8, 'low',    2, 1.2),  (8, 'low',    3, 1.1),  (8, 'low',    4, 0.9),
  (8, 'low',    5, 1.1),  (8, 'low',    6, 1.2),  (8, 'low',    7, 1.5),  (8, 'low',    8, 2.0),
  (8, 'medium', 0, 4.0),  (8, 'medium', 1, 2.0),  (8, 'medium', 2, 1.4),  (8, 'medium', 3, 1.1),  (8, 'medium', 4, 0.5),
  (8, 'medium', 5, 1.1),  (8, 'medium', 6, 1.4),  (8, 'medium', 7, 2.0),  (8, 'medium', 8, 4.0),
  (8, 'high',   0, 10.0), (8, 'high',   1, 5.0),  (8, 'high',   2, 2.0),  (8, 'high',   3, 1.2),  (8, 'high',   4, 0.2),
  (8, 'high',   5, 1.2),  (8, 'high',   6, 2.0),  (8, 'high',   7, 5.0),  (8, 'high',   8, 10.0),
  -- 10 rows (11 bins)
  (10, 'low',    0, 2.0),  (10, 'low',    1, 1.5),  (10, 'low',    2, 1.3),  (10, 'low',    3, 1.2),  (10, 'low',    4, 1.1),
  (10, 'low',    5, 1.0),  (10, 'low',    6, 1.1),  (10, 'low',    7, 1.2),  (10, 'low',    8, 1.3),  (10, 'low',    9, 1.5),  (10, 'low',    10, 2.0),
  (10, 'medium', 0, 5.0),  (10, 'medium', 1, 2.5),  (10, 'medium', 2, 1.6),  (10, 'medium', 3, 1.2),  (10, 'medium', 4, 1.0),
  (10, 'medium', 5, 0.5),  (10, 'medium', 6, 1.0),  (10, 'medium', 7, 1.2),  (10, 'medium', 8, 1.6),  (10, 'medium', 9, 2.5),  (10, 'medium', 10, 5.0),
  (10, 'high',   0, 16.0), (10, 'high',   1, 8.0),  (10, 'high',   2, 4.0),  (10, 'high',   3, 2.0),  (10, 'high',   4, 1.2),
  (10, 'high',   5, 0.2),  (10, 'high',   6, 1.2),  (10, 'high',   7, 2.0),  (10, 'high',   8, 4.0),  (10, 'high',   9, 8.0),  (10, 'high',   10, 16.0),
  -- 12 rows (13 bins)
  (12, 'low',    0, 2.0),  (12, 'low',    1, 1.6),  (12, 'low',    2, 1.4),  (12, 'low',    3, 1.3),  (12, 'low',    4, 1.2),
  (12, 'low',    5, 1.1),  (12, 'low',    6, 1.0),  (12, 'low',    7, 1.1),  (12, 'low',    8, 1.2),  (12, 'low',    9, 1.3),  (12, 'low',    10, 1.4),  (12, 'low',    11, 1.6),  (12, 'low',    12, 2.0),
  (12, 'medium', 0, 8.0),  (12, 'medium', 1, 4.0),  (12, 'medium', 2, 2.0),  (12, 'medium', 3, 1.4),  (12, 'medium', 4, 1.1),
  (12, 'medium', 5, 1.0),  (12, 'medium', 6, 0.5),  (12, 'medium', 7, 1.0),  (12, 'medium', 8, 1.1),  (12, 'medium', 9, 1.4),  (12, 'medium', 10, 2.0),  (12, 'medium', 11, 4.0),  (12, 'medium', 12, 8.0),
  (12, 'high',   0, 24.0), (12, 'high',   1, 12.0), (12, 'high',   2, 6.0),  (12, 'high',   3, 3.0),  (12, 'high',   4, 1.8),
  (12, 'high',   5, 1.0),  (12, 'high',   6, 0.2),  (12, 'high',   7, 1.0),  (12, 'high',   8, 1.8),  (12, 'high',   9, 3.0),  (12, 'high',   10, 6.0),  (12, 'high',   11, 12.0), (12, 'high',   12, 24.0)
on conflict (rows_count, risk, bin_index) do update set multiplier = excluded.multiplier;

-- ---------------------------------------------------------------------------
-- 3. Core RPC: play_plinko
-- ---------------------------------------------------------------------------
create or replace function public.play_plinko(
  p_bet  integer,
  p_rows integer default 8,
  p_risk text default 'medium'
) returns table (
  new_balance  integer,
  path         boolean[],
  bin_index    int,
  multiplier   numeric,
  payout       integer,
  won          boolean
)
language plpgsql security definer set search_path = public as $$
declare
  uid       uuid := auth.uid();
  prof      public.profiles%rowtype;
  rows_     int  := coalesce(p_rows, 8);
  risk_     text := coalesce(p_risk, 'medium');
  n_bins    int  := rows_ + 1;
  bin       int  := 0;   -- bin_index (0 = far left)
  i         int;
  went_right boolean;
  path_     boolean[] := array[]::boolean[];
  mult      numeric;
  pay       integer;
  did_win   boolean;
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

  select * into prof from public.profiles where id = uid for update;
  if prof.credits < p_bet then raise exception 'Not enough credits (need %)', p_bet; end if;

  perform public._apply_credit_delta(uid, -p_bet, 'plinko',
    jsonb_build_object('phase','wager','rows',rows_,'risk',risk_));

  -- Random walk: true = right (increments bin), false = left
  for i in 1..rows_ loop
    went_right := random() > 0.5;
    path_ := array_append(path_, went_right);
    if went_right then bin := bin + 1; end if;
  end loop;

  select m.multiplier into mult
    from public.plinko_mult m
   where m.rows_count = rows_ and m.risk = risk_ and m.bin_index = bin;

  if mult is null then
    raise exception 'No multiplier for rows=%, risk=%, bin=%', rows_, risk_, bin;
  end if;

  pay := floor(p_bet::numeric * mult)::int;
  did_win := pay > p_bet;

  if pay > 0 then
    perform public._apply_credit_delta(uid, pay, 'plinko',
      jsonb_build_object('phase','payout','rows',rows_,'risk',risk_,'bin',bin,'mult',mult,'payout',pay));
  end if;

  insert into public.plinko_drops (user_id, bet, rows_used, risk, path, bin_index, multiplier, payout)
    values (uid, p_bet, rows_, risk_, path_, bin, mult, pay);

  select credits into new_balance from public.profiles where id = uid;
  return query select new_balance, path_, bin, mult, pay, did_win;
end; $$;
grant execute on function public.play_plinko(integer, integer, text) to authenticated;

-- Done.
