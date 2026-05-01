-- =============================================================================
-- v6_leaderboards.sql
--
-- Adds multiple leaderboards backed by tiny, indexed profile columns so every
-- board is an O(log N) index scan. No materialised views, no cron jobs — this
-- keeps us firmly inside the Supabase free tier and means every leaderboard
-- updates in real time without the app ever running `REFRESH MATERIALIZED
-- VIEW`.
--
-- Strategy:
--   * Add 4 denormalised stats columns to `profiles`
--       biggest_single_win   — max positive credit delta from a single bet
--       cases_opened         — count of successful case_openings rows
--       items_unique         — COUNT(DISTINCT item_id WHERE qty > 0)
--       items_total          — SUM(qty)
--
--   * Keep them up to date with small AFTER INSERT triggers:
--       on transactions      → biggest_single_win
--       on case_openings     → cases_opened
--       on user_items        → items_unique + items_total
--
--   * Index every column we sort by with a DESC btree.
--
--   * Ship one read-only view per leaderboard, each hard-capped at LIMIT 100.
--     Client code picks the one it needs; RLS-wise they're all public to
--     authenticated users, same as the original v_leaderboard.
--
--   * Backfill once from existing data.
-- =============================================================================

set search_path = public;

-- -----------------------------------------------------------------------------
-- 1. Add stats columns (idempotent)
-- -----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists biggest_single_win integer not null default 0,
  add column if not exists cases_opened       integer not null default 0,
  add column if not exists items_unique       integer not null default 0,
  add column if not exists items_total        integer not null default 0;

-- -----------------------------------------------------------------------------
-- 2. Triggers
-- -----------------------------------------------------------------------------

-- 2a. transactions → biggest_single_win
-- Any positive delta that came from a game or event payout counts. We ignore
-- daily_claim / signup_bonus (those aren't "wins"), and naturally ignore
-- negative deltas (bets placed).
create or replace function public._bump_biggest_win()
returns trigger language plpgsql as $$
begin
  if new.delta > 0 and new.kind in (
    'bet_payout',
    'game_coinflip','game_dice','game_roulette','game_blackjack','game_crash',
    'emoji_hunt'
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

-- 2b. case_openings → cases_opened counter
-- Function is always (re)defined; the trigger is only attached if the v3
-- table exists so this migration is idempotent on fresh databases too.
create or replace function public._bump_cases_opened()
returns trigger language plpgsql as $$
begin
  update public.profiles
     set cases_opened = cases_opened + 1
   where id = new.user_id;
  return new;
end; $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'case_openings'
  ) then
    execute 'drop trigger if exists bump_cases_opened on public.case_openings';
    execute 'create trigger bump_cases_opened
              after insert on public.case_openings
              for each row execute function public._bump_cases_opened()';
  end if;
end $$;

-- 2c. user_items → items_unique + items_total
-- Triggered on all three mutations because all three (insert new row, bump
-- qty, zero out qty on sale/list) affect the counters.
create or replace function public._recalc_items_counters()
returns trigger language plpgsql as $$
declare
  uid uuid := coalesce(new.user_id, old.user_id);
  u   integer;
  t   integer;
begin
  select
    coalesce(count(*) filter (where qty > 0), 0),
    coalesce(sum(qty), 0)
    into u, t
    from public.user_items
   where user_id = uid;
  update public.profiles
     set items_unique = u,
         items_total  = t
   where id = uid;
  return coalesce(new, old);
end; $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'user_items'
  ) then
    execute 'drop trigger if exists recalc_items_counters_ins on public.user_items';
    execute 'drop trigger if exists recalc_items_counters_upd on public.user_items';
    execute 'drop trigger if exists recalc_items_counters_del on public.user_items';
    execute 'create trigger recalc_items_counters_ins
              after insert on public.user_items
              for each row execute function public._recalc_items_counters()';
    execute 'create trigger recalc_items_counters_upd
              after update of qty on public.user_items
              for each row execute function public._recalc_items_counters()';
    execute 'create trigger recalc_items_counters_del
              after delete on public.user_items
              for each row execute function public._recalc_items_counters()';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 3. Backfill from existing data (one-shot, idempotent)
-- -----------------------------------------------------------------------------

-- biggest_single_win
update public.profiles p
   set biggest_single_win = greatest(
     p.biggest_single_win,
     coalesce((
       select max(t.delta)
         from public.transactions t
        where t.user_id = p.id
          and t.delta > 0
          and t.kind in (
            'bet_payout','game_coinflip','game_dice','game_roulette',
            'game_blackjack','game_crash','emoji_hunt'
          )
     ), 0)
   );

-- cases_opened
do $$
begin
  if exists (
    select 1 from information_schema.tables
     where table_schema='public' and table_name='case_openings'
  ) then
    execute $bf$
      update public.profiles p
         set cases_opened = coalesce((
           select count(*) from public.case_openings c where c.user_id = p.id
         ), 0)
    $bf$;
  end if;
end $$;

-- items_unique / items_total
do $$
begin
  if exists (
    select 1 from information_schema.tables
     where table_schema='public' and table_name='user_items'
  ) then
    execute $bf$
      update public.profiles p
         set items_unique = coalesce((
               select count(*) from public.user_items ui
                where ui.user_id = p.id and ui.qty > 0
             ), 0),
             items_total  = coalesce((
               select sum(qty) from public.user_items ui
                where ui.user_id = p.id
             ), 0)
    $bf$;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 4. Indexes (DESC for leaderboard ordering)
-- -----------------------------------------------------------------------------
create index if not exists profiles_credits_desc_idx
  on public.profiles (credits desc);
create index if not exists profiles_peak_credits_desc_idx
  on public.profiles (peak_credits desc);
create index if not exists profiles_biggest_win_desc_idx
  on public.profiles (biggest_single_win desc);
create index if not exists profiles_total_won_desc_idx
  on public.profiles (total_won desc);
create index if not exists profiles_total_wagered_desc_idx
  on public.profiles (total_wagered desc);
create index if not exists profiles_cases_opened_desc_idx
  on public.profiles (cases_opened desc);
create index if not exists profiles_items_unique_desc_idx
  on public.profiles (items_unique desc);

-- -----------------------------------------------------------------------------
-- 5. Views
--
-- Every view is LIMIT 100 so the planner never has to page past the top of
-- the matching index. All return the same shape so the client can render
-- rows generically.
-- -----------------------------------------------------------------------------

-- 5a. rewrite the main one to include all new columns
drop view if exists public.v_leaderboard;
create view public.v_leaderboard as
  select id, display_name, avatar_url,
         credits, peak_credits,
         total_wagered, total_won,
         biggest_single_win, cases_opened,
         items_unique, items_total
    from public.profiles
   order by credits desc
   limit 100;

-- 5b. peak credits
create or replace view public.v_lb_peak as
  select id, display_name, avatar_url,
         peak_credits as value, credits, total_won, biggest_single_win
    from public.profiles
   where peak_credits > 0
   order by peak_credits desc
   limit 100;

-- 5c. biggest single win
create or replace view public.v_lb_biggest_win as
  select id, display_name, avatar_url,
         biggest_single_win as value, credits, peak_credits, total_won
    from public.profiles
   where biggest_single_win > 0
   order by biggest_single_win desc
   limit 100;

-- 5d. total won
create or replace view public.v_lb_total_won as
  select id, display_name, avatar_url,
         total_won as value, credits, peak_credits, biggest_single_win
    from public.profiles
   where total_won > 0
   order by total_won desc
   limit 100;

-- 5e. total wagered
create or replace view public.v_lb_total_wagered as
  select id, display_name, avatar_url,
         total_wagered as value, credits, peak_credits, total_won
    from public.profiles
   where total_wagered > 0
   order by total_wagered desc
   limit 100;

-- 5f. cases opened
create or replace view public.v_lb_cases as
  select id, display_name, avatar_url,
         cases_opened as value, credits, biggest_single_win, items_unique
    from public.profiles
   where cases_opened > 0
   order by cases_opened desc
   limit 100;

-- 5g. collection — unique items owned (ties broken by items_total)
create or replace view public.v_lb_collection as
  select id, display_name, avatar_url,
         items_unique as value, items_total, credits, peak_credits
    from public.profiles
   where items_unique > 0
   order by items_unique desc, items_total desc
   limit 100;

grant select on public.v_leaderboard,
                 public.v_lb_peak,
                 public.v_lb_biggest_win,
                 public.v_lb_total_won,
                 public.v_lb_total_wagered,
                 public.v_lb_cases,
                 public.v_lb_collection
  to authenticated, anon;

-- =============================================================================
-- Done. Expect this migration to finish in < 500 ms on a fresh DB, longer
-- only if you already have millions of transactions (the one-shot backfill
-- scans transactions once).
-- =============================================================================
