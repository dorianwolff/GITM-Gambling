-- ============================================================================
-- Migration v22 — weekly leaderboard + futuristic pinball
-- ----------------------------------------------------------------------------
-- Adds a Monday-reset weekly credits board and a new pinball game that
-- uses a server-start / client-sim / server-settle flow.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Widen transactions.kind.
-- ----------------------------------------------------------------------------
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
    'plinko','lottery','warfront','achievement_award',
    'pinball',
    -- legacy / alternate spellings already in the table:
    'game_plinko','game_lottery','game_warfront',
    'gacha_pull',
    'mines_bet','mines_cashout',
    'candy_bet','candy_payout'
  ));


-- ----------------------------------------------------------------------------
-- 1. Weekly credits leaderboard.
-- ----------------------------------------------------------------------------
create or replace function public.weekly_leaderboard_start(p_at timestamptz default now())
returns date
language sql
stable
set search_path = public
as $$
  select date_trunc('week', timezone('utc', coalesce(p_at, now())))::date;
$$;

alter table public.profiles
  add column if not exists weekly_credits_earned bigint not null default 0,
  add column if not exists weekly_credits_window_start date not null default public.weekly_leaderboard_start();

create index if not exists profiles_weekly_credits_idx
  on public.profiles (weekly_credits_earned desc)
  where weekly_credits_earned > 0;

create or replace function public._weekly_credits_refresh()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  week_start date := public.weekly_leaderboard_start();
begin
  update public.profiles
     set weekly_credits_earned = 0,
         weekly_credits_window_start = week_start
   where weekly_credits_window_start is distinct from week_start;
end;
$$;

create or replace view public.v_lb_weekly_credits as
  select id, display_name, avatar_url,
         weekly_credits_earned as value,
         credits, peak_credits, total_won, total_wagered,
         weekly_credits_window_start
    from public.profiles
   where coalesce(is_banned, false) = false
     and weekly_credits_earned > 0
   order by weekly_credits_earned desc, credits desc
   limit 100;


-- ----------------------------------------------------------------------------
-- 2. Apply weekly earning tracking to credit mutations.
-- ----------------------------------------------------------------------------
create or replace function public._apply_credit_delta(
  p_user uuid,
  p_delta integer,
  p_kind text,
  p_meta jsonb default '{}'::jsonb
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance integer;
  week_start date := public.weekly_leaderboard_start();
begin
  update public.profiles
     set credits = credits + p_delta,
         total_wagered = total_wagered + greatest(-p_delta, 0),
         total_won = total_won + greatest( p_delta, 0),
         peak_credits = greatest(peak_credits, credits + p_delta),
         weekly_credits_earned = case
           when p_delta > 0 and weekly_credits_window_start = week_start then weekly_credits_earned + p_delta
           when p_delta > 0 then p_delta
           when weekly_credits_window_start = week_start then weekly_credits_earned
           else 0
         end,
         weekly_credits_window_start = week_start
   where id = p_user
   returning credits into new_balance;

  if new_balance is null then
    raise exception 'Profile not found';
  end if;
  if new_balance < 0 then
    raise exception 'Insufficient credits';
  end if;

  insert into public.transactions (user_id, delta, balance_after, kind, meta)
  values (p_user, p_delta, new_balance, p_kind, p_meta);

  return new_balance;
end;
$$;

create or replace function public._admin_apply_credit_delta(
  p_user uuid,
  p_delta integer,
  p_kind text,
  p_meta jsonb default '{}'::jsonb
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance integer;
  week_start date := public.weekly_leaderboard_start();
begin
  update public.profiles
     set credits = credits + p_delta,
         peak_credits = greatest(peak_credits, credits + p_delta),
         weekly_credits_earned = case
           when p_delta > 0 and weekly_credits_window_start = week_start then weekly_credits_earned + p_delta
           when p_delta > 0 then p_delta
           when weekly_credits_window_start = week_start then weekly_credits_earned
           else 0
         end,
         weekly_credits_window_start = week_start
   where id = p_user
   returning credits into new_balance;

  if new_balance is null then
    raise exception 'Profile not found';
  end if;
  if new_balance < 0 then
    raise exception 'Insufficient credits';
  end if;

  insert into public.transactions (user_id, delta, balance_after, kind, meta)
  values (p_user, p_delta, new_balance, p_kind, p_meta);

  return new_balance;
end;
$$;


-- ----------------------------------------------------------------------------
-- 3. Pinball history table.
-- ----------------------------------------------------------------------------
create table if not exists public.pinball_rounds (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles(id) on delete cascade,
  bet                 integer not null check (bet > 0),
  ball_count          integer not null default 3 check (ball_count between 1 and 5),
  map_key             text not null,
  seed                bigint not null,
  score               integer not null default 0,
  combo_max           integer not null default 0,
  bumper_hits         integer not null default 0,
  target_hits         integer not null default 0,
  zone_hits           integer not null default 0,
  jam_hits            integer not null default 0,
  drain_hits          integer not null default 0,
  payout              integer not null default 0,
  summary             jsonb not null default '{}'::jsonb,
  status              text not null default 'active' check (status in ('active','settled','abandoned')),
  started_at          timestamptz not null default now(),
  settled_at          timestamptz
);

create index if not exists pinball_rounds_user_idx on public.pinball_rounds (user_id, started_at desc);
create index if not exists pinball_rounds_status_idx on public.pinball_rounds (status, started_at desc);

alter table public.pinball_rounds enable row level security;


-- ----------------------------------------------------------------------------
-- 4. Pinball RPCs.
-- ----------------------------------------------------------------------------
drop function if exists public.play_pinball_round(integer,integer);
create or replace function public.play_pinball_round(
  p_bet integer,
  p_ball_count integer default 3
) returns table(
  round_id uuid,
  map_key text,
  map_name text,
  seed bigint,
  ball_count integer,
  stake integer,
  new_balance integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  prof public.profiles%rowtype;
  maps text[] := array['enchanted_forest','galaxy_drift','deep_sea','inferno_volcano','cyber_circuit'];
  map_names text[] := array['Enchanted Forest','Galaxy Drift','Deep Sea','Inferno Volcano','Cyber Circuit'];
  choice int;
  stake_total integer;
  round_uuid uuid;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  perform public._txn_user_lock('pinball');

  if not public.is_game_active('pinball') then
    raise exception 'Pinball is currently out of rotation';
  end if;
  if p_bet is null or p_bet < 1 then
    raise exception 'bet must be >= 1';
  end if;
  if p_ball_count is null or p_ball_count < 1 or p_ball_count > 5 then
    raise exception 'ball count must be 1..5';
  end if;

  stake_total := p_bet * p_ball_count;

  select * into prof from public.profiles where id = uid for update;
  if prof.credits < stake_total then
    raise exception 'Not enough credits (need %)', stake_total;
  end if;

  choice := 1 + floor(random() * array_length(maps, 1))::int;
  map_key := maps[choice];
  map_name := map_names[choice];
  seed := floor(random() * 1000000000000)::bigint;

  perform public._apply_credit_delta(
    uid,
    -stake_total,
    'pinball',
    jsonb_build_object(
      'phase', 'wager',
      'bet', p_bet,
      'balls', p_ball_count,
      'map_key', map_key,
      'map_name', map_name,
      'seed', seed
    )
  );

  insert into public.pinball_rounds (user_id, bet, ball_count, map_key, seed, summary, status)
  values (uid, p_bet, p_ball_count, map_key, seed, '{}'::jsonb, 'active')
  returning id into round_uuid;

  select credits into new_balance from public.profiles where id = uid;

  round_id := round_uuid;
  ball_count := p_ball_count;
  stake := stake_total;
  return next;
end;
$$;

drop function if exists public.settle_pinball_round(uuid,jsonb);
create or replace function public.settle_pinball_round(
  p_round_id uuid,
  p_summary jsonb default '{}'::jsonb
) returns table(
  round_id uuid,
  map_key text,
  score integer,
  combo_max integer,
  payout integer,
  new_balance integer,
  won boolean,
  summary jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  r public.pinball_rounds%rowtype;
  summary_data jsonb := coalesce(p_summary, '{}'::jsonb);
  score_local integer := greatest(coalesce((summary_data->>'score')::integer, 0), 0);
  combo_local integer := greatest(coalesce((summary_data->>'combo_max')::integer, 0), 0);
  bumper_hits_local integer := greatest(coalesce((summary_data->>'bumper_hits')::integer, 0), 0);
  target_hits_local integer := greatest(coalesce((summary_data->>'target_hits')::integer, 0), 0);
  zone_hits_local integer := greatest(coalesce((summary_data->>'zone_hits')::integer, 0), 0);
  jam_hits_local integer := greatest(coalesce((summary_data->>'jam_hits')::integer, 0), 0);
  drain_hits_local integer := greatest(coalesce((summary_data->>'drain_hits')::integer, 0), 0);
  stake_total integer;
  payout_total integer;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  perform public._txn_user_lock('pinball');

  select * into r
    from public.pinball_rounds
   where id = p_round_id
     and user_id = uid
   for update;

  if not found then
    raise exception 'Pinball round not found';
  end if;
  if r.status <> 'active' then
    raise exception 'Pinball round already settled';
  end if;

  stake_total := r.bet * r.ball_count;

  -- Simple payout: score / 100 rounded up.
  -- Player must earn enough points to beat the stake.
  payout_total := greatest(0, ceil(score_local::numeric / 100.0)::int);

  perform public._apply_credit_delta(
    uid,
    payout_total,
    'pinball',
    jsonb_build_object(
      'phase', 'payout',
      'round_id', p_round_id,
      'map_key', r.map_key,
      'score', score_local,
      'combo_max', combo_local,
      'bumper_hits', bumper_hits_local,
      'target_hits', target_hits_local,
      'zone_hits', zone_hits_local,
      'jam_hits', jam_hits_local,
      'drain_hits', drain_hits_local,
      'stake', stake_total,
      'summary', summary_data
    )
  );

  update public.pinball_rounds
     set score = score_local,
         combo_max = combo_local,
         bumper_hits = bumper_hits_local,
         target_hits = target_hits_local,
         zone_hits = zone_hits_local,
         jam_hits = jam_hits_local,
         drain_hits = drain_hits_local,
         payout = payout_total,
         summary = summary_data,
         status = 'settled',
         settled_at = now()
   where id = r.id;

  select credits into new_balance from public.profiles where id = uid;

  round_id := r.id;
  map_key := r.map_key;
  score := score_local;
  combo_max := combo_local;
  payout := payout_total;
  won := payout_total > stake_total;
  summary := summary_data;
  return next;
end;
$$;

grant execute on function public.play_pinball_round(integer,integer) to authenticated;
grant execute on function public.settle_pinball_round(uuid,jsonb) to authenticated;


-- ----------------------------------------------------------------------------
-- 5. Leaderboard tick and full reset updates.
-- ----------------------------------------------------------------------------
create or replace function public.leaderboard_tick()
returns void
language plpgsql
security definer
set search_path = public as $$
declare
  top_uid uuid;
  reward  int := 5;
begin
  perform public._weekly_credits_refresh();

  begin
    select id into top_uid from public.profiles
      where coalesce(is_banned, false) = false and credits > 0
      order by credits desc limit 1;
    perform public._kh_touch('credits', 'king_of_credits', top_uid, reward);
  exception when others then null; end;

  begin
    select id into top_uid from public.profiles
      where coalesce(is_banned, false) = false and peak_credits > 0
      order by peak_credits desc limit 1;
    perform public._kh_touch('peak', 'king_of_peak', top_uid, reward);
  exception when others then null; end;

  begin
    select id into top_uid from public.profiles
      where coalesce(is_banned, false) = false and biggest_single_win > 0
      order by biggest_single_win desc limit 1;
    perform public._kh_touch('biggest_win', 'king_of_biggest_win', top_uid, reward);
  exception when others then null; end;

  begin
    select id into top_uid from public.profiles
      where coalesce(is_banned, false) = false and total_won > 0
      order by total_won desc limit 1;
    perform public._kh_touch('total_won', 'king_of_total_won', top_uid, reward);
  exception when others then null; end;

  begin
    select id into top_uid from public.profiles
      where coalesce(is_banned, false) = false and total_wagered > 0
      order by total_wagered desc limit 1;
    perform public._kh_touch('total_wagered', 'king_of_total_wagered', top_uid, reward);
  exception when others then null; end;

  begin
    select id into top_uid from public.profiles
      where coalesce(is_banned, false) = false and cases_opened > 0
      order by cases_opened desc limit 1;
    perform public._kh_touch('cases', 'king_of_cases', top_uid, reward);
  exception when others then null; end;

  begin
    select id into top_uid from public.profiles
      where coalesce(is_banned, false) = false and items_unique > 0
      order by items_unique desc, items_total desc limit 1;
    perform public._kh_touch('collection', 'king_of_collection', top_uid, reward);
  exception when others then null; end;
end; $$;

grant execute on function public.leaderboard_tick() to authenticated;


-- ----------------------------------------------------------------------------
-- 6. Rotation pool.
-- ----------------------------------------------------------------------------
create or replace function public.game_pool()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[
    'blackjack','candy','cases','coinflip','crash','dice',
    'gacha','mines','plinko','roulette','lottery','warfront','pinball'
  ]::text[];
$$;


-- ----------------------------------------------------------------------------
-- 7. Full reset adds pinball history and weekly reset.
-- ----------------------------------------------------------------------------
create or replace function public.admin_reset_all_progress()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._admin_assert();

  execute '
    truncate table
      public.transactions,
      public.event_bets,
      public.events,
      public.emoji_hunts,
      public.case_openings,
      public.gacha_pulls,
      public.user_items,
      public.market_bids,
      public.market_listings,
      public.blackjack_hands,
      public.minesweeper_games,
      public.candy_spins,
      public.plinko_drops,
      public.lottery_draws,
      public.mp_games,
      public.warfront_games,
      public.pinball_rounds,
      public.leaderboard_reigns,
      public.user_achievements
    restart identity cascade';

  update public.gacha_pool
     set claimed_by = null,
         claimed_at = null
   where is_unique;

  update public.profiles
     set credits = 200,
         peak_credits = 200,
         total_wagered = 0,
         total_won = 0,
         biggest_single_win = 0,
         cases_opened = 0,
         items_unique = 0,
         items_total = 0,
         streak_days = 0,
         last_claim_date = null,
         case_pity = 0,
         gacha_pity = 0,
         weekly_credits_earned = 0,
         weekly_credits_window_start = public.weekly_leaderboard_start();
end;
$$;

grant execute on function public.admin_reset_all_progress() to authenticated;

-- ============================================================================
-- End migration.
-- ============================================================================
