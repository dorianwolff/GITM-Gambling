-- ============================================================================
-- v11_emoji_active_pages.sql
--   Emoji-hunt spawns now only target pages that are *currently reachable*
--   for the average user:
--     * Always-on pages (dashboard, profile, market, events, …)
--     * Per-game routes ONLY when the corresponding game is in the active
--       6-game rotation (queried from active_games)
--   This stops emojis from being spawned on, say, /games/cases when cases
--   is locked out — non-admins are redirected away from those routes by
--   `requireActiveGame`, so an emoji there would never be findable.
--
--   Also adds the new game routes (mines, candy) to the candidate set.
--
-- Run AFTER v7/v8/v9/v10. Idempotent: safe to re-run.
-- ============================================================================

-- Helper: build the candidate page list dynamically. Always-on pages are
-- hard-coded; game pages are joined against `active_games` so a page only
-- appears if the game is in rotation right now. The rotator is lazy
-- (rotates on read); calling it here also nudges expired slots out.
create or replace function public._emoji_spawn_pages()
returns text[]
language plpgsql security definer set search_path = public as $$
declare
  always_on text[] := array[
    '/', '/dashboard',
    '/events', '/leaderboard', '/history',
    '/market', '/market/inventory',
    '/profile',
    '/games', '/games/lobby', '/games/emoji-hunt'
  ];
  -- Map every rotation game id to its public route. New games get added
  -- here; the array literal is short enough that maintaining it inline
  -- beats a side table.
  game_routes jsonb := jsonb_build_object(
    'coinflip',  '/games/coinflip',
    'dice',      '/games/dice',
    'roulette',  '/games/roulette',
    'blackjack', '/games/blackjack',
    'crash',     '/games/crash',
    'cases',     '/games/cases',
    'gacha',     '/games/gacha',
    'mines',     '/games/mines',
    'candy',     '/games/candy'
  );
  active_routes text[];
begin
  -- Pull only currently-active game routes. ends_at filter guards against
  -- a stale row that hasn't been swept yet.
  select coalesce(array_agg(game_routes->>game_id), array[]::text[])
    into active_routes
    from public.active_games
   where ends_at > now()
     and game_routes ? game_id;

  -- If rotation is somehow empty (cold boot before first rotate), fall
  -- back to always-on only — better to spawn there than nowhere at all.
  return always_on || coalesce(active_routes, array[]::text[]);
end; $$;
grant execute on function public._emoji_spawn_pages() to authenticated;


-- Manual spawn — uses the dynamic page list. Signature unchanged.
create or replace function public.spawn_emoji_hunt(
  p_page    text default null,
  p_size_px integer default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  pool   text[] := array['💎','🪙','🎰','🍀','⭐','🔥','🚀','👑','🦄','🎲','💸','🎁','🏆','🎯','🍒'];
  routes text[] := public._emoji_spawn_pages();
  uid    uuid := auth.uid();
  emo    text;
  page   text;
  sz     integer;
  new_id uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if array_length(routes, 1) is null then
    -- Should never happen (always-on pages are always present), but
    -- guard against it so we don't divide-by-zero on the index pick.
    raise exception 'No spawn pages available';
  end if;
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


-- Auto-spawn — same body as v7 but route source switched to the helper.
create or replace function public.auto_spawn_emoji_hunt()
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  MIN_GAP_SEC constant int := 60;
  MAX_GAP_SEC constant int := 180;
  MAX_ACTIVE  constant int := 6;
  meta       jsonb;
  next_due   timestamptz;
  active_cnt int;
  pool       text[] := array['💎','🪙','🎰','🍀','⭐','🔥','🚀','👑','🦄','🎲','💸','🎁','🏆','🎯','🍒'];
  routes     text[];
  emo        text;
  page       text;
  sz         integer;
  new_id     uuid;
  now_ts     timestamptz := now();
  gap_sec    int;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select value into meta from public.gitm_meta
    where key = 'emoji_autospawn' for update;

  next_due := nullif(meta->>'next_due_at', '')::timestamptz;

  if next_due is null then
    next_due := now_ts + (10 + floor(random()*50))::int * interval '1 second';
    update public.gitm_meta
      set value = jsonb_build_object('last_at', null, 'next_due_at', next_due)
      where key = 'emoji_autospawn';
    return null;
  end if;

  if now_ts < next_due then return null; end if;

  select count(*) into active_cnt
    from public.emoji_hunts
    where found_by is null and expires_at > now_ts;

  if active_cnt >= MAX_ACTIVE then
    next_due := now_ts + (15 + floor(random()*45))::int * interval '1 second';
    update public.gitm_meta
      set value = jsonb_build_object('last_at', meta->>'last_at', 'next_due_at', next_due)
      where key = 'emoji_autospawn';
    return null;
  end if;

  -- Resolve the candidate pages NOW so the spawn lands somewhere a user
  -- can actually navigate to (always-on + currently-rotated game routes).
  routes := public._emoji_spawn_pages();
  if array_length(routes, 1) is null then return null; end if;

  emo  := pool[1 + floor(random()*array_length(pool,1))::int];
  page := routes[1 + floor(random()*array_length(routes,1))::int];
  sz   := 36 + floor(random()*64)::int;

  insert into public.emoji_hunts
    (emoji, reward, position_x, position_y, expires_at, page_path, size_px)
  values
    (emo, 25, random(), 0.1 + random()*0.8, now_ts + interval '45 seconds', page, sz)
  returning id into new_id;

  gap_sec  := MIN_GAP_SEC + floor(random()*(MAX_GAP_SEC - MIN_GAP_SEC))::int;
  next_due := now_ts + gap_sec * interval '1 second';
  update public.gitm_meta
    set value = jsonb_build_object('last_at', now_ts, 'next_due_at', next_due)
    where key = 'emoji_autospawn';

  return new_id;
end; $$;
grant execute on function public.auto_spawn_emoji_hunt() to authenticated;

-- Done.
