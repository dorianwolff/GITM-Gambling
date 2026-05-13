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
  landed_bin  int not null default 0,
  created_at  timestamptz not null default now()
);

alter table public.plinko_drops
  add column if not exists landed_bin int not null default 0;

create index if not exists plinko_drops_user_idx on public.plinko_drops (user_id, created_at desc);

create table if not exists public.plinko_batches (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  bet          integer not null check (bet > 0),
  rows_used    int not null default 8 check (rows_used between 4 and 12),
  risk         text not null check (risk in ('low','medium','high')) default 'medium',
  count        int not null default 1 check (count between 1 and 50),
  total_bet    integer not null,
  settled_bins int[] not null default array[]::int[],
  payout       integer not null default 0,
  status       text not null default 'pending' check (status in ('pending','settled')),
  created_at   timestamptz not null default now(),
  settled_at   timestamptz
);

create index if not exists plinko_batches_user_idx on public.plinko_batches (user_id, created_at desc);

alter table public.plinko_batches enable row level security;

drop policy if exists "plinko batch read own" on public.plinko_batches;
create policy "plinko batch read own" on public.plinko_batches
  for select using (auth.uid() = user_id);

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
  (8,'low',    0,5.49),(8,'low',    1,2.06),(8,'low',    2,1.08),(8,'low',    3,0.98),(8,'low',    4,0.49),
  (8,'low',    5,0.98),(8,'low',    6,1.08),(8,'low',    7,2.06),(8,'low',    8,5.49),
  (8,'medium', 0,12.75),(8,'medium',1,2.94),(8,'medium',2,1.28),(8,'medium',3,0.69),(8,'medium',4,0.39),
  (8,'medium', 5,0.69),(8,'medium',6,1.28),(8,'medium',7,2.94),(8,'medium',8,12.75),
  (8,'high',   0,28.39),(8,'high',  1,3.92),(8,'high',  2,1.47),(8,'high',  3,0.29),(8,'high',  4,0.20),
  (8,'high',   5,0.29),(8,'high',  6,1.47),(8,'high',  7,3.92),(8,'high',  8,28.39),
  -- 10 rows (11 bins)
  (10,'low',    0,8.72),(10,'low',    1,2.94),(10,'low',    2,1.37),(10,'low',    3,1.08),(10,'low',    4,0.98),(10,'low',    5,0.49),
  (10,'low',    6,0.98),(10,'low',    7,1.08),(10,'low',    8,1.37),(10,'low',    9,2.94),(10,'low',   10,8.72),
  (10,'medium', 0,21.58),(10,'medium',1,4.90),(10,'medium',2,1.96),(10,'medium',3,1.37),(10,'medium',4,0.59),(10,'medium',5,0.39),
  (10,'medium', 6,0.59),(10,'medium',7,1.37),(10,'medium',8,1.96),(10,'medium',9,4.90),(10,'medium',10,21.58),
  (10,'high',   0,74.84),(10,'high',  1,9.85),(10,'high', 2,3.94),(10,'high',  3,0.49),(10,'high',  4,0.30),(10,'high',  5,0.20),
  (10,'high',   6,0.30),(10,'high',  7,0.49),(10,'high',  8,3.94),(10,'high',  9,9.85),(10,'high', 10,74.84),
  -- 12 rows (13 bins)
  (12,'low',    0,10.02),(12,'low',    1,3.01),(12,'low',    2,1.60),(12,'low',    3,1.20),(12,'low',    4,1.10),(12,'low',    5,1.00),(12,'low',    6,0.50),
  (12,'low',    7,1.00),(12,'low',    8,1.10),(12,'low',    9,1.20),(12,'low',   10,1.60),(12,'low',   11,3.01),(12,'low',   12,10.02),
  (12,'medium', 0,33.14),(12,'medium',1,11.05),(12,'medium',2,4.02),(12,'medium',3,2.01),(12,'medium',4,1.00),(12,'medium',5,0.60),(12,'medium',6,0.30),
  (12,'medium', 7,0.60),(12,'medium',8,1.00),(12,'medium',9,2.01),(12,'medium',10,4.02),(12,'medium',11,11.05),(12,'medium',12,33.14),
  (12,'high',   0,168.09),(12,'high', 1,23.73),(12,'high',  2,8.01),(12,'high',  3,1.98),(12,'high',  4,0.49),(12,'high',  5,0.30),(12,'high',  6,0.20),
  (12,'high',   7,0.30),(12,'high',  8,0.49),(12,'high',  9,1.98),(12,'high', 10,8.01),(12,'high', 11,23.73),(12,'high', 12,168.09)
on conflict (rows_count, risk, bin_index) do update set multiplier = excluded.multiplier;

-- ---------------------------------------------------------------------------
-- 3. Core RPC: play_plinko
-- ---------------------------------------------------------------------------
create or replace function public._plinko_spin(
  p_rows integer default 8,
  p_risk text default 'medium'
) returns table (
  path boolean[],
  bin_index int,
  multiplier numeric
)
language plpgsql volatile set search_path = public as $$
declare
  rows_ int := coalesce(p_rows, 8);
  risk_ text := coalesce(p_risk, 'medium');
  i_ int;
  went_right boolean;
  bin_ int := 0;
  path_ boolean[] := array[]::boolean[];
begin
  if rows_ < 4 or rows_ > 12 then raise exception 'rows must be 4..12'; end if;
  if risk_ not in ('low','medium','high') then raise exception 'risk must be low/medium/high'; end if;

  for i_ in 1..rows_ loop
    went_right := random() > 0.5;
    path_ := array_append(path_, went_right);
    if went_right then
      bin_ := bin_ + 1;
    end if;
  end loop;

  select m.multiplier into multiplier
    from public.plinko_mult m
   where m.rows_count = rows_ and m.risk = risk_ and m.bin_index = bin_;

  if multiplier is null then
    raise exception 'No multiplier for rows=%, risk=%, bin=%', rows_, risk_, bin_;
  end if;

  path := path_;
  bin_index := bin_;
  return next;
end; $$;

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
  path_     boolean[];
  bin       int;
  mult      numeric;
  pay       integer;
  did_win   boolean;
  bal       integer;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

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

  select s.path, s.bin_index, s.multiplier
    into path_, bin, mult
    from public._plinko_spin(rows_, risk_) s;

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

drop function if exists public.play_plinko_batch(integer, integer, text, integer);

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
declare
  uid        uuid := auth.uid();
  prof       public.profiles%rowtype;
  rows_      int := coalesce(p_rows, 8);
  risk_      text := coalesce(p_risk, 'medium');
  cnt        int := coalesce(p_count, 1);
  total_bet  integer;
  total_pay  integer := 0;
  i_         int;
  path_      boolean[];
  bin_       int;
  mult       numeric;
  pay        integer;
  bal        integer;
  paths_     jsonb[] := array[]::jsonb[];
  bins_      int[] := array[]::int[];
  mults_     numeric[] := array[]::numeric[];
  pays_      int[] := array[]::int[];
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not public.is_game_active('plinko') then
    raise exception 'Plinko is currently out of rotation';
  end if;
  if p_bet is null or p_bet < 1 then raise exception 'bet must be >= 1'; end if;
  if rows_ < 4 or rows_ > 12 then raise exception 'rows must be 4..12'; end if;
  if risk_ not in ('low','medium','high') then raise exception 'risk must be low/medium/high'; end if;
  if cnt < 1 or cnt > 50 then raise exception 'count must be 1..50'; end if;

  total_bet := p_bet * cnt;
  select * into prof from public.profiles where id = uid for update;
  if prof.credits < total_bet then raise exception 'Not enough credits (need %)', total_bet; end if;

  perform public._apply_credit_delta(uid, -total_bet, 'plinko',
    jsonb_build_object('phase','wager','rows',rows_,'risk',risk_,'count',cnt,'per_bet',p_bet));

  for i_ in 1..cnt loop
    select s.path, s.bin_index, s.multiplier
      into path_, bin_, mult
      from public._plinko_spin(rows_, risk_) s;

    pay := floor(p_bet::numeric * mult)::int;
    total_pay := total_pay + pay;
    insert into public.plinko_drops (user_id, bet, rows_used, risk, path, bin_index, multiplier, payout)
      values (uid, p_bet, rows_, risk_, path_, bin_, mult, pay);
    paths_ := array_append(paths_, to_jsonb(path_));
    bins_  := array_append(bins_, bin_);
    mults_ := array_append(mults_, mult);
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
grant execute on function public.play_plinko_batch(integer, integer, text, integer) to authenticated;

-- Done.

-- ---------------------------------------------------------------------------
-- 4. Batch start + settle RPCs for physics-driven plinko
-- ---------------------------------------------------------------------------
create or replace function public.plinko_multiplier_for_bin(
  p_rows integer,
  p_risk text,
  p_bin  integer
) returns numeric
language sql stable set search_path = public as $$
  select multiplier
    from public.plinko_mult
   where rows_count = p_rows and risk = p_risk and bin_index = p_bin;
$$;

drop function if exists public.play_plinko_batch(integer, integer, text, integer);

create or replace function public.play_plinko_batch(
  p_bet   integer,
  p_rows  integer default 8,
  p_risk  text    default 'medium',
  p_count integer default 1
) returns table (
  batch_id     uuid,
  new_balance  integer
)
language plpgsql security definer set search_path = public as $$
declare
  uid        uuid := auth.uid();
  prof       public.profiles%rowtype;
  rows_      int := coalesce(p_rows, 8);
  risk_      text := coalesce(p_risk, 'medium');
  cnt        int := coalesce(p_count, 1);
  total_bet  integer;
  batch_     uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
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

  insert into public.plinko_batches (user_id, bet, rows_used, risk, count, total_bet)
    values (uid, p_bet, rows_, risk_, cnt, total_bet)
    returning id into batch_;

  select credits into new_balance from public.profiles where id = uid;
  return query select batch_, new_balance;
end; $$;

grant execute on function public.play_plinko_batch(integer, integer, text, integer) to authenticated;

create or replace function public.settle_plinko_batch(
  p_batch_id uuid,
  p_bins     int[]
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
  bins_      int[] := array[]::int[];
  mults_     numeric[] := array[]::numeric[];
  pays_      int[] := array[]::int[];
  bal        integer;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  if p_batch_id is null then raise exception 'batch id is required'; end if;
  select * into batch from public.plinko_batches where id = p_batch_id and user_id = uid for update;
  if not found then raise exception 'Batch not found'; end if;
  if batch.status <> 'pending' then raise exception 'Batch already settled'; end if;
  if coalesce(array_length(p_bins, 1), 0) <> batch.count then
    raise exception 'Expected % bins, got %', batch.count, coalesce(array_length(p_bins, 1), 0);
  end if;

  for i_ in 1..batch.count loop
    bin_ := p_bins[i_];
    mult_ := public.plinko_multiplier_for_bin(batch.rows_used, batch.risk, bin_);
    if mult_ is null then
      raise exception 'No multiplier for rows=%, risk=%, bin=%', batch.rows_used, batch.risk, bin_;
    end if;

    pay_ := floor(batch.bet::numeric * mult_)::int;
    total_pay := total_pay + pay_;
    bins_  := array_append(bins_, bin_);
    mults_ := array_append(mults_, mult_);
    pays_  := array_append(pays_, pay_);

    insert into public.plinko_drops (user_id, bet, rows_used, risk, path, bin_index, multiplier, payout, landed_bin)
      values (uid, batch.bet, batch.rows_used, batch.risk, array[]::boolean[], bin_, mult_, pay_, bin_);
  end loop;

  if total_pay > 0 then
    perform public._apply_credit_delta(uid, total_pay, 'plinko',
      jsonb_build_object('phase','payout','rows',batch.rows_used,'risk',batch.risk,'count',batch.count,
                         'total_payout',total_pay,'batch_id',p_batch_id));
  end if;

  update public.plinko_batches
     set settled_bins = p_bins,
         payout = total_pay,
         status = 'settled',
         settled_at = now()
   where id = p_batch_id;

  select credits into bal from public.profiles where id = uid;
  for i_ in 1..batch.count loop
    idx         := i_ - 1;
    bin_index   := bins_[i_];
    multiplier  := mults_[i_];
    payout      := pays_[i_];
    won         := pays_[i_] > batch.bet;
    new_balance := bal;
    return next;
  end loop;
end; $$;

grant execute on function public.settle_plinko_batch(uuid, int[]) to authenticated;
