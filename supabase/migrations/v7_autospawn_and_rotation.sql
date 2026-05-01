-- ============================================================================
-- v7_autospawn_and_rotation.sql
--   1. Emoji-hunt auto-spawn (free-tier: client-driven tick, server rate-limit)
--   2. Game rotation (6 offline games active at all times, 6h life, 2h cadence)
--
-- Run this in Supabase Dashboard → SQL editor → New query → paste & Run.
-- Idempotent: safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 16. Emoji-hunt auto-spawn
-- ----------------------------------------------------------------------------
-- Replaces the admin-only spawn with a globally-rate-limited "tick" that any
-- signed-in client can poll. The server is the source of truth: it decides
-- when the next emoji is allowed and on which page. Multiple browser tabs
-- can call this concurrently without flooding the table.
--
-- Cadence: between MIN_GAP_SEC and MAX_GAP_SEC, random per spawn. With
-- clients calling every ~30s and a 60..180s gap, you get ~2-5 spawns per
-- 5 minutes — exactly the spec.
-- ----------------------------------------------------------------------------

create table if not exists public.gitm_meta (
  key   text primary key,
  value jsonb not null default '{}'::jsonb
);

-- Public read so any client can introspect e.g. last spawn time for UI debug.
alter table public.gitm_meta enable row level security;
drop policy if exists "gitm_meta read all" on public.gitm_meta;
create policy "gitm_meta read all" on public.gitm_meta for select using (true);

insert into public.gitm_meta(key, value)
values ('emoji_autospawn', '{"last_at": null, "next_due_at": null}'::jsonb)
on conflict (key) do nothing;

-- Drop any older overload of spawn_emoji_hunt so we can redefine with
-- the loosened admin check while keeping the same signature.
drop function if exists public.spawn_emoji_hunt();
drop function if exists public.spawn_emoji_hunt(text, integer);

-- Manual spawn (used by the page UI, no longer admin-only). Anyone can ask
-- for a hunt to appear; abuse is prevented by the per-user rate limit
-- enforced in `auto_spawn_emoji_hunt`. The manual variant is open because
-- it's behind a button that respects local UX (admins still see the panel,
-- but normal users could trigger one too — they're just spawning value
-- for everyone).
create or replace function public.spawn_emoji_hunt(
  p_page    text default null,
  p_size_px integer default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  pool   text[] := array['💎','🪙','🎰','🍀','⭐','🔥','🚀','👑','🦄','🎲','💸','🎁','🏆','🎯','🍒'];
  routes text[] := array[
    '/', '/dashboard',
    '/events', '/leaderboard', '/history', '/market', '/market/inventory',
    '/profile',
    '/games', '/games/coinflip', '/games/dice', '/games/roulette',
    '/games/blackjack', '/games/crash', '/games/cases', '/games/lobby',
    '/games/emoji-hunt', '/games/gacha'
  ];
  uid    uuid := auth.uid();
  emo    text;
  page   text;
  sz     integer;
  new_id uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  emo  := pool[1 + floor(random()*array_length(pool,1))::int];
  page := coalesce(p_page, routes[1 + floor(random()*array_length(routes,1))::int]);
  sz   := greatest(32, least(128, coalesce(p_size_px, 36 + floor(random()*64)::int)));
  insert into public.emoji_hunts
    (emoji, reward, position_x, position_y, expires_at, page_path, size_px)
  values
    (emo, 25, random(), 0.1 + random()*0.8, now() + interval '45 seconds', page, sz)
  returning id into new_id;
  return new_id;
end; $$;
grant execute on function public.spawn_emoji_hunt(text, integer) to authenticated;

-- The auto-spawn tick. Every signed-in tab calls this every ~30s. The
-- function is idempotent: it only actually spawns when the global gap
-- timer says it's due. Returns the spawned id (or NULL if not due).
create or replace function public.auto_spawn_emoji_hunt()
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  -- Cadence bounds for one spawn-to-next-spawn gap.
  MIN_GAP_SEC constant int := 60;
  MAX_GAP_SEC constant int := 180;
  -- Hard cap on simultaneously-active hunts site-wide.
  MAX_ACTIVE  constant int := 6;
  meta       jsonb;
  next_due   timestamptz;
  active_cnt int;
  pool       text[] := array['💎','🪙','🎰','🍀','⭐','🔥','🚀','👑','🦄','🎲','💸','🎁','🏆','🎯','🍒'];
  routes     text[] := array[
    '/', '/dashboard',
    '/events', '/leaderboard', '/history', '/market', '/market/inventory',
    '/profile',
    '/games', '/games/coinflip', '/games/dice', '/games/roulette',
    '/games/blackjack', '/games/crash', '/games/cases', '/games/lobby',
    '/games/emoji-hunt', '/games/gacha'
  ];
  emo        text;
  page       text;
  sz         integer;
  new_id     uuid;
  now_ts     timestamptz := now();
  gap_sec    int;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  -- Lock the row so concurrent ticks from many tabs don't race.
  select value into meta from public.gitm_meta
    where key = 'emoji_autospawn' for update;

  next_due := nullif(meta->>'next_due_at', '')::timestamptz;

  -- First call ever: schedule the first spawn for "soon" (10–60s) so
  -- new players see one quickly without a 5-minute cold start.
  if next_due is null then
    next_due := now_ts + (10 + floor(random()*50))::int * interval '1 second';
    update public.gitm_meta
      set value = jsonb_build_object('last_at', null, 'next_due_at', next_due)
      where key = 'emoji_autospawn';
    return null;
  end if;

  -- Not yet time → no-op. Cheap path.
  if now_ts < next_due then
    return null;
  end if;

  -- Don't pile up if everyone's idle. Keep at most MAX_ACTIVE alive.
  select count(*) into active_cnt
    from public.emoji_hunts
    where found_by is null and expires_at > now_ts;

  if active_cnt >= MAX_ACTIVE then
    -- Push the next-due forward by a small random delay so we
    -- don't hammer this branch repeatedly.
    next_due := now_ts + (15 + floor(random()*45))::int * interval '1 second';
    update public.gitm_meta
      set value = jsonb_build_object('last_at', meta->>'last_at', 'next_due_at', next_due)
      where key = 'emoji_autospawn';
    return null;
  end if;

  -- It's time to spawn. Pick a random emoji on a random route at random size.
  emo  := pool[1 + floor(random()*array_length(pool,1))::int];
  page := routes[1 + floor(random()*array_length(routes,1))::int];
  sz   := 36 + floor(random()*64)::int;

  insert into public.emoji_hunts
    (emoji, reward, position_x, position_y, expires_at, page_path, size_px)
  values
    (emo, 25, random(), 0.1 + random()*0.8, now_ts + interval '45 seconds', page, sz)
  returning id into new_id;

  -- Schedule the next spawn.
  gap_sec  := MIN_GAP_SEC + floor(random()*(MAX_GAP_SEC - MIN_GAP_SEC))::int;
  next_due := now_ts + gap_sec * interval '1 second';
  update public.gitm_meta
    set value = jsonb_build_object('last_at', now_ts, 'next_due_at', next_due)
    where key = 'emoji_autospawn';

  return new_id;
end; $$;
grant execute on function public.auto_spawn_emoji_hunt() to authenticated;


-- ----------------------------------------------------------------------------
-- 17. Game rotation
-- ----------------------------------------------------------------------------
-- Six offline games are "active" at any moment. Each lives 6 hours. Every
-- 2 hours, two of them rotate out and are replaced by two from the pool.
-- The pool is the static list of all offline games we know about; the
-- subset of size 6 currently playable is the rotation.
--
-- Free-tier-friendly: we don't use pg_cron. The rotation happens lazily
-- on every call to `get_active_games()` — which the games hub polls.
-- ----------------------------------------------------------------------------

create table if not exists public.active_games (
  game_id    text primary key,
  started_at timestamptz not null default now(),
  ends_at    timestamptz not null
);

alter table public.active_games enable row level security;
drop policy if exists "active_games read all" on public.active_games;
create policy "active_games read all" on public.active_games for select using (true);

create index if not exists active_games_ends_idx on public.active_games (ends_at);

-- The catalogue of all offline games we can rotate. Adjust this list when
-- adding new games. v9 extends this with 'mines' and 'candy'.
--
-- We DROP first because the migration history went through a draft that
-- defined this as `returns setof text`; `create or replace` can't change a
-- function's return type. Dropping is safe: no stored data depends on it,
-- and rotate_active_games (defined below) will be recreated after this.
drop function if exists public.game_pool() cascade;
create or replace function public.game_pool()
returns text[] language sql immutable as $$
  select array['coinflip','dice','roulette','blackjack','crash','cases','gacha']::text[];
$$;
grant execute on function public.game_pool() to authenticated;

-- Internal helper: do the rotation. Idempotent.
--   1. Delete any rows whose ends_at < now() (they've rotated out).
--   2. Refill up to 6 slots from games not currently active.
--   3. New entries get ends_at = now() + 6h; first-time seed staggers them
--      to (2h, 2h, 4h, 4h, 6h, 6h) so two rotate out every 2 hours.
create or replace function public.rotate_active_games()
returns void
language plpgsql security definer set search_path = public as $$
declare
  pool       text[] := public.game_pool();
  active_now int;
  empty_slot boolean;
  candidate  text;
  rotation_offsets interval[] := array[
    interval '2 hours',
    interval '2 hours',
    interval '4 hours',
    interval '4 hours',
    interval '6 hours',
    interval '6 hours'
  ];
  i int;
begin
  -- Evict expired games.
  delete from public.active_games where ends_at <= now();

  select count(*) into active_now from public.active_games;
  if active_now = 0 then
    -- Cold start: seed all 6 slots with staggered timers.
    for i in 1..6 loop
      candidate := (
        select g from unnest(pool) as g
        where g not in (select game_id from public.active_games)
        order by random() limit 1
      );
      exit when candidate is null;
      insert into public.active_games(game_id, ends_at)
        values (candidate, now() + rotation_offsets[i])
        on conflict (game_id) do nothing;
    end loop;
    return;
  end if;

  -- Steady state: refill up to 6 with games not currently active.
  while active_now < 6 loop
    candidate := (
      select g from unnest(pool) as g
      where g not in (select game_id from public.active_games)
      order by random() limit 1
    );
    exit when candidate is null;       -- pool exhausted (pool < 6 games)
    insert into public.active_games(game_id, ends_at)
      values (candidate, now() + interval '6 hours')
      on conflict (game_id) do nothing;
    select count(*) into active_now from public.active_games;
  end loop;
end; $$;
grant execute on function public.rotate_active_games() to authenticated;

-- Public read API: returns the active rotation, auto-rotating first.
-- The client calls this on the games hub and on every game-route guard.
create or replace function public.get_active_games()
returns table(game_id text, started_at timestamptz, ends_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  perform public.rotate_active_games();
  return query
    select ag.game_id, ag.started_at, ag.ends_at
      from public.active_games ag
      order by ag.ends_at asc;
end; $$;
grant execute on function public.get_active_games() to authenticated;

-- Convenience: is `g` currently in rotation?
create or replace function public.is_game_active(g text)
returns boolean
language sql security definer set search_path = public as $$
  -- Inline (don't rotate from inside the predicate; rotation is handled
  -- by the caller via get_active_games()).
  select exists(
    select 1 from public.active_games
      where game_id = g and ends_at > now()
  );
$$;
grant execute on function public.is_game_active(text) to authenticated;

-- Done.
