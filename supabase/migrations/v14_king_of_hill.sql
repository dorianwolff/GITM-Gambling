-- ============================================================================
-- v14_king_of_hill.sql
--   "King of the Hill" achievement: hold #1 on any leaderboard for at least
--   one continuous hour to unlock it. Each user may unlock it AT MOST ONCE
--   PER LEADERBOARD. The reward is a fixed credit grant + a persistent
--   badge row the profile page / public profile can display.
--
-- Design — free-tier friendly, no pg_cron:
--   * Table `leaderboard_reigns` keeps a single row per (user, board) with
--     the timestamp the current reign began and the last time it was
--     confirmed. If user X is #1 on board B now, we upsert reign_start the
--     first time, then keep bumping `last_seen_at = now()`. When a
--     different user becomes #1, the row is replaced with the new
--     champion's reign_start = now().
--   * Table `user_achievements` is the immutable ledger. A row here means
--     "user unlocked this achievement", one per (user, code).
--   * `leaderboard_tick()` is an idempotent RPC. Every leaderboard-page
--     load calls it. It:
--       1. Walks each configured leaderboard view.
--       2. Finds the current #1 user.
--       3. Touches (or replaces) the reign row.
--       4. If the reign is old enough (>= 1h) AND the (user, code)
--          achievement row doesn't yet exist, INSERT it and credit the
--          reward. Both in one tx so we can't double-grant.
--     The tick is safe to call concurrently: the achievement INSERT uses
--     ON CONFLICT DO NOTHING on the unique (user_id, code) key.
--
-- Reward: 5_000 cr per unlocked board + a badge flag on the user profile
-- (via metadata; no new column). Adjust at will.
--
-- Depends on: v6 (profiles + leaderboard views), v12 (tx kind
-- 'achievement_award' was pre-reserved).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables.
-- ---------------------------------------------------------------------------
create table if not exists public.leaderboard_reigns (
  board_id      text        not null,
  user_id       uuid        not null references public.profiles(id) on delete cascade,
  reign_start   timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  primary key (board_id)
);

alter table public.leaderboard_reigns enable row level security;
drop policy if exists "reigns read all" on public.leaderboard_reigns;
create policy "reigns read all" on public.leaderboard_reigns for select using (true);
-- No insert/update policy: only security-definer RPCs write.

create table if not exists public.user_achievements (
  user_id     uuid        not null references public.profiles(id) on delete cascade,
  code        text        not null,              -- e.g. 'king_of_credits'
  awarded_at  timestamptz not null default now(),
  meta        jsonb       not null default '{}'::jsonb,
  primary key (user_id, code)
);

create index if not exists user_achievements_user_idx
  on public.user_achievements (user_id, awarded_at desc);

alter table public.user_achievements enable row level security;
drop policy if exists "achievements read all" on public.user_achievements;
create policy "achievements read all" on public.user_achievements
  for select using (true);

-- ---------------------------------------------------------------------------
-- 2. Board catalogue. Maps board_id (stable string) to the view that
--    produces its ranking. Keeping this in SQL makes it trivial to add a
--    new board: one row here + one function clause. We keep the list
--    inline in the tick function below (no dynamic SQL — safer & faster
--    on a 7-row loop).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 3. The tick. Called by anyone who loads a leaderboard page. Safe to
--    over-call; cost is 7 index lookups.
-- ---------------------------------------------------------------------------
create or replace function public.leaderboard_tick()
returns void
language plpgsql security definer set search_path = public as $$
declare
  -- (board_id, achievement_code, sql_to_get_top_user_id, min-value-filter)
  -- We hardcode one case per board rather than a table + EXECUTE because
  -- it's three lines of Postgres and avoids any dynamic SQL footgun.
  top_uid uuid;
  reward  int := 5000;
  reign_age interval;
begin
  -- credits board
  select id into top_uid from public.profiles
    where credits > 0 order by credits desc limit 1;
  perform public._kh_touch('credits', 'king_of_credits', top_uid, reward);

  -- peak_credits
  select id into top_uid from public.profiles
    where peak_credits > 0 order by peak_credits desc limit 1;
  perform public._kh_touch('peak', 'king_of_peak', top_uid, reward);

  -- biggest_single_win
  select id into top_uid from public.profiles
    where biggest_single_win > 0 order by biggest_single_win desc limit 1;
  perform public._kh_touch('biggest_win', 'king_of_biggest_win', top_uid, reward);

  -- total_won
  select id into top_uid from public.profiles
    where total_won > 0 order by total_won desc limit 1;
  perform public._kh_touch('total_won', 'king_of_total_won', top_uid, reward);

  -- total_wagered
  select id into top_uid from public.profiles
    where total_wagered > 0 order by total_wagered desc limit 1;
  perform public._kh_touch('total_wagered', 'king_of_total_wagered', top_uid, reward);

  -- cases_opened
  select id into top_uid from public.profiles
    where cases_opened > 0 order by cases_opened desc limit 1;
  perform public._kh_touch('cases', 'king_of_cases', top_uid, reward);

  -- items_unique (collection)
  select id into top_uid from public.profiles
    where items_unique > 0 order by items_unique desc, items_total desc limit 1;
  perform public._kh_touch('collection', 'king_of_collection', top_uid, reward);
end; $$;
grant execute on function public.leaderboard_tick() to authenticated;

-- Internal helper: bump the reign row for `board`, and award the
-- achievement if the current holder has reigned long enough and hasn't
-- received the code before. Splitting this out keeps the tick's loop body
-- a single call.
create or replace function public._kh_touch(
  p_board text,
  p_code  text,
  p_user  uuid,
  p_reward integer
) returns void
language plpgsql security definer set search_path = public as $$
declare
  cur_reign record;
  reign_age interval;
  min_age   interval := interval '1 hour';
begin
  if p_user is null then
    -- No-one on the board yet; make sure any stale reign is cleared so
    -- the next holder's timer starts fresh.
    delete from public.leaderboard_reigns where board_id = p_board;
    return;
  end if;

  select * into cur_reign from public.leaderboard_reigns
    where board_id = p_board for update;

  if not found then
    insert into public.leaderboard_reigns(board_id, user_id)
      values (p_board, p_user);
    return;
  end if;

  if cur_reign.user_id <> p_user then
    -- New champion — reset the clock.
    update public.leaderboard_reigns
       set user_id = p_user,
           reign_start = now(),
           last_seen_at = now()
     where board_id = p_board;
    return;
  end if;

  -- Same champion still on top: extend last_seen, maybe award.
  update public.leaderboard_reigns
     set last_seen_at = now()
   where board_id = p_board;

  reign_age := now() - cur_reign.reign_start;
  if reign_age >= min_age then
    -- Award once; (user_id, code) is PK on user_achievements.
    insert into public.user_achievements(user_id, code, meta)
      values (p_user, p_code,
              jsonb_build_object('board', p_board,
                                 'reign_start', cur_reign.reign_start,
                                 'awarded_for', 'king_of_the_hill_1h'))
      on conflict (user_id, code) do nothing;

    if found then
      -- `found` after INSERT ... ON CONFLICT DO NOTHING is true only when
      -- a row was actually inserted. Grant the reward once.
      perform public._apply_credit_delta(p_user, p_reward, 'achievement_award',
        jsonb_build_object('code', p_code, 'board', p_board));
    end if;
  end if;
end; $$;

revoke all on function public._kh_touch(text, text, uuid, integer) from public;

-- ---------------------------------------------------------------------------
-- 4. Read helper: my achievements (lets the profile page show badges).
-- ---------------------------------------------------------------------------
create or replace function public.my_achievements()
returns setof public.user_achievements
language sql stable security definer set search_path = public as $$
  select * from public.user_achievements
    where user_id = auth.uid()
    order by awarded_at desc;
$$;
grant execute on function public.my_achievements() to authenticated;

-- And for viewing other users' boards of glory:
create or replace function public.user_achievements_for(p_user uuid)
returns setof public.user_achievements
language sql stable security definer set search_path = public as $$
  select * from public.user_achievements
    where user_id = p_user
    order by awarded_at desc;
$$;
grant execute on function public.user_achievements_for(uuid) to authenticated;

-- Done.
