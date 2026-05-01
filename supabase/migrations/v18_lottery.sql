-- ============================================================================
-- v18_lottery.sql
--   Neon Lotto — pick 5 numbers from 1-36, draw 5, match for multipliers.
--   ~97% RTP. Server-resolved with atomic credit delta.
--
--   Pick 5 unique numbers. Server draws 5 unique numbers from 1-36.
--   More matches = higher payout.
--
--   Depends on: v12 (transactions.kind 'lottery' pre-reserved), v13 (rotation).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Widen transactions.kind (idempotent — safe to re-run)
-- ---------------------------------------------------------------------------
alter table public.transactions drop constraint if exists transactions_kind_check;
alter table public.transactions
  add constraint transactions_kind_check check (kind in (
    'daily_claim','signup_bonus',
    'bet_place','bet_payout',
    'game_coinflip','game_dice','game_roulette','game_blackjack','game_crash',
    'game_case','game_mp','mp_refund',
    'emoji_hunt','admin_grant','admin_revoke',
    'market_buy','market_list_fee','market_bid_escrow','market_bid_refund',
    'market_sale_payout','market_auction_refund',
    'gacha_pull','gacha_payout',
    'mines_bet','mines_cashout','candy_bet','candy_payout',
    'plinko',
    'lottery',
    'achievement_award'
  ));

-- ---------------------------------------------------------------------------
-- 1. History table
-- ---------------------------------------------------------------------------
create table if not exists public.lottery_draws (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  bet         integer not null check (bet > 0),
  picks       int[] not null check (array_length(picks, 1) = 5),
  drawn       int[] not null check (array_length(drawn, 1) = 5),
  matches     int not null check (matches between 0 and 5),
  multiplier  numeric not null,
  payout      integer not null,
  created_at  timestamptz not null default now()
);

create index if not exists lottery_draws_user_idx on public.lottery_draws (user_id, created_at desc);

alter table public.lottery_draws enable row level security;

drop policy if exists "lottery read own" on public.lottery_draws;
create policy "lottery read own" on public.lottery_draws
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 2. Payout table (matches -> multiplier)
--    RTP tuned to ~97% for 5/36 format:
--      2 matches: 6x
--      3 matches: 16x
--      4 matches: 100x
--      5 matches: 8000x
-- ---------------------------------------------------------------------------
create table if not exists public.lottery_payout (
  matches     int primary key check (matches between 0 and 5),
  multiplier  numeric not null
);

insert into public.lottery_payout (matches, multiplier)
values
  (0, 0), (1, 0),
  (2, 6), (3, 16), (4, 100), (5, 8000)
on conflict (matches) do update set multiplier = excluded.multiplier;

-- ---------------------------------------------------------------------------
-- 3. Core RPC: play_lottery
-- ---------------------------------------------------------------------------
create or replace function public.play_lottery(
  p_bet   integer,
  p_picks integer[]
) returns table (
  new_balance integer,
  drawn       integer[],
  matches     integer,
  multiplier  numeric,
  payout      integer,
  won         boolean
) language plpgsql security definer set search_path = public as $$
declare
  v_user_id  uuid := auth.uid();
  v_balance  integer;
  v_picks    int[];
  v_drawn    int[];
  v_matches  int;
  v_mult     numeric;
  v_payout   int;
  v_pool     int[] := array(
    select generate_series(1, 36)
  );
  v_slot     int;
  v_idx      int;
begin
  -- auth check
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = 'P0001';
  end if;

  -- validate bet
  if p_bet <= 0 then
    raise exception 'Bet must be > 0' using errcode = 'P0001';
  end if;

  -- lock balance
  select credits into v_balance
  from public.profiles where id = v_user_id for update;

  if v_balance < p_bet then
    raise exception 'Not enough credits' using errcode = 'P0001';
  end if;

  -- validate picks: 5 unique numbers 1-36
  v_picks := array(
    select distinct unnest(p_picks)
    order by 1
  );
  if array_length(v_picks, 1) != 5 then
    raise exception 'Pick exactly 5 unique numbers' using errcode = 'P0001';
  end if;
  if v_picks[1] < 1 or v_picks[array_length(v_picks,1)] > 36 then
    raise exception 'Numbers must be 1-36' using errcode = 'P0001';
  end if;

  -- draw 5 unique numbers (Fisher-Yates shuffle on 1..36)
  v_drawn := '{}';
  for v_idx in 1..5 loop
    v_slot := 1 + floor(random() * (36 - v_idx + 1))::int;
    v_drawn := array_append(v_drawn, v_pool[v_slot]);
    v_pool[v_slot] := v_pool[36 - v_idx + 1];
  end loop;

  -- count matches
  select count(*) into v_matches
  from unnest(v_picks) p
  where p = any(v_drawn);

  -- lookup multiplier
  select lp.multiplier into v_mult
  from public.lottery_payout lp
  where lp.matches = v_matches;

  v_payout := floor(p_bet * v_mult)::int;

  -- update balance and capture result
  update public.profiles
  set credits = credits - p_bet + v_payout
  where id = v_user_id
  returning credits into v_balance;

  -- record history
  insert into public.lottery_draws (user_id, bet, picks, drawn, matches, multiplier, payout)
  values (v_user_id, p_bet, v_picks, v_drawn, v_matches, v_mult, v_payout);

  -- record transaction
  insert into public.transactions (user_id, delta, balance_after, kind, meta)
  values (v_user_id, v_payout - p_bet, v_balance, 'lottery', jsonb_build_object(
    'bet', p_bet,
    'picks', v_picks,
    'drawn', v_drawn,
    'matches', v_matches,
    'multiplier', v_mult
  ));

  return query select
    (v_balance - p_bet + v_payout)::integer as new_balance,
    v_drawn,
    v_matches,
    v_mult,
    v_payout,
    (v_payout > p_bet) as won;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Rotation — add lottery to game pool
-- ---------------------------------------------------------------------------
create or replace function public.game_pool()
returns text[] language sql immutable as $$
  select array[
    'blackjack','candy','cases','coinflip','crash','dice',
    'gacha','mines','roulette','lottery'
  ]::text[];
$$;
