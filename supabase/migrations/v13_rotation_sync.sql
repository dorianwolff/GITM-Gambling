-- ============================================================================
-- v13_rotation_sync.sql
--   Make the 6-active-of-9-games rotation GLOBALLY DETERMINISTIC and
--   clock-aligned, so every client sees identical countdowns.
--
-- Why this replaces the v7 table-driven rotation:
--   * v7 stored a mutable `active_games` row per game with `ends_at = now()
--     + Nh` computed at INSERT time. Two users who fetched the rotation
--     five minutes apart would see timers that differed by five minutes,
--     and drift compounded over cold starts / failed calls.
--   * The screenshot the user posted showed staggers of 3h55m / 1h55m /
--     6h00m — the legacy 2h-cadence, 6h-lifetime, cold-seed-with-random-
--     offsets design. Confusing and user-invisible.
--
-- New contract (one line):
--   ACTIVE_AT(t) = the 6 games whose expiry windows cover the clock hour
--   containing t, picked from a FIXED pool index by a pure hour counter.
--
-- Formal definition:
--   pool       = ['blackjack','candy','cases','coinflip','crash','dice',
--                 'gacha','mines','roulette']            -- 9 entries, fixed
--   epoch      = '2026-01-01 00:00:00+00'               -- aligned to UTC hour
--   H          = floor( (now - epoch) / 1 hour )
--   active[k]  = pool[ (H - k) mod 9 ]    for k in 0..5
--   ends_at[k] = epoch + (H - k + 6) hours
--
--   One game rotates out every hour on the hour. One replaces it. All
--   remaining timers tick down by the same minute. Every client — no
--   matter when they first connected — derives the same table from the
--   same `now()` on the server, so everyone sees the exact same clock.
--
-- Back-compat: `get_active_games()` and `is_game_active()` keep their
-- shapes and behave identically for callers. The `active_games` TABLE
-- is left behind but no longer written — nothing reads it after this
-- migration. `rotate_active_games()` is redefined to a no-op so any
-- stale caller doesn't error out.
--
-- Idempotent: safe to re-run. Depends on: v7, v10 (admin bypass).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The canonical rotation epoch + period. We store them as a function so
--    callers (and tests) can reference a single source of truth. inline
--    would work too but a function makes the intent explicit and lets us
--    re-pick the epoch without touching every call-site.
-- ---------------------------------------------------------------------------
create or replace function public._rotation_epoch()
returns timestamptz language sql immutable as $$
  select '2026-01-01 00:00:00+00'::timestamptz;
$$;

create or replace function public._rotation_period()
returns interval language sql immutable as $$
  select '1 hour'::interval;
$$;

create or replace function public._rotation_lifetime()
returns interval language sql immutable as $$
  select '6 hours'::interval;
$$;

-- Fixed alphabetical pool. If you add a new game, append it and ship a
-- new migration that increments this list — everyone's rotation rolls
-- forward deterministically once the function body changes.
create or replace function public.game_pool()
returns text[] language sql immutable as $$
  select array[
    'blackjack','candy','cases','coinflip','crash','dice',
    'gacha','mines','plinko','roulette'
  ]::text[];
$$;
grant execute on function public.game_pool() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. get_active_games() — the deterministic snapshot.
--
-- Returns 6 rows sorted by `ends_at` ascending (soonest-to-expire first),
-- matching the legacy contract. started_at = ends_at - lifetime so the UI
-- progress bars still work without code changes.
-- ---------------------------------------------------------------------------
drop function if exists public.get_active_games();
create or replace function public.get_active_games()
returns table(game_id text, started_at timestamptz, ends_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  pool       text[] := public.game_pool();
  n          int    := array_length(pool, 1);
  active_n   int    := 6;                       -- matches lifetime/period
  epoch      timestamptz := public._rotation_epoch();
  period     interval    := public._rotation_period();
  lifetime   interval    := public._rotation_lifetime();
  h_index    bigint;     -- current hour index, can be large
  k          int;
  slot_idx   int;
  ea         timestamptz;
begin
  if n is null or n < active_n then
    -- Defensive: if the pool ever shrinks below 6 games, fall back to
    -- returning whatever's in the pool with dummy timers so the UI
    -- doesn't explode. This should not happen in practice.
    for k in 1..coalesce(n, 0) loop
      game_id    := pool[k];
      started_at := now();
      ends_at    := now() + lifetime;
      return next;
    end loop;
    return;
  end if;

  -- Hour index relative to epoch. Negative when called before epoch
  -- (shouldn't happen post-deploy, but we're safe).
  h_index := floor(extract(epoch from (now() - epoch)) / extract(epoch from period))::bigint;

  -- Emit the 6 active slots in ascending-ends_at order (k counts down
  -- from 5 so the soonest-to-expire slot is emitted first, matching the
  -- legacy ORDER BY ends_at ASC contract). slot_idx lives in [0, n) via
  -- the double-mod trick so negatives wrap correctly.
  for k in reverse (active_n - 1)..0 loop
    slot_idx := ((h_index - k) % n + n) % n;
    game_id    := pool[slot_idx + 1];     -- sql arrays are 1-based
    ea         := epoch + ((h_index - k + active_n) * period);
    started_at := ea - lifetime;
    ends_at    := ea;
    return next;
  end loop;
end; $$;

grant execute on function public.get_active_games() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. is_game_active(g) — pure-computed. Admins still bypass (v10 contract).
-- ---------------------------------------------------------------------------
create or replace function public.is_game_active(g text)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  uid      uuid := auth.uid();
  is_admin boolean := false;
  pool     text[] := public.game_pool();
  n        int    := array_length(pool, 1);
  epoch    timestamptz := public._rotation_epoch();
  period   interval    := public._rotation_period();
  h_index  bigint;
  k        int;
  slot_idx int;
begin
  -- Admin bypass — preserves v10 behaviour so admins can always play
  -- locked-out games for testing.
  if uid is not null then
    select coalesce(p.is_admin, false)
      into is_admin
      from public.profiles p where p.id = uid;
    if is_admin then return true; end if;
  end if;

  if g is null or n is null or n = 0 then return false; end if;
  h_index := floor(extract(epoch from (now() - epoch)) / extract(epoch from period))::bigint;
  for k in 0..5 loop
    slot_idx := ((h_index - k) % n + n) % n;
    if pool[slot_idx + 1] = g then return true; end if;
  end loop;
  return false;
end; $$;
grant execute on function public.is_game_active(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. rotate_active_games() — kept as a no-op so stale callers don't 404.
--    The old mutable table (`public.active_games`) is left in place but
--    unused; we don't drop it to preserve RLS policies and any audit data.
-- ---------------------------------------------------------------------------
create or replace function public.rotate_active_games()
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Rotation is now a pure function of wall-clock time. This used to
  -- mutate `public.active_games`; keeping the symbol as a no-op means
  -- old migrations / cron hooks that call it still succeed.
  perform 1;
end; $$;
grant execute on function public.rotate_active_games() to authenticated;

-- Clear any stale rows so they can't confuse human operators reading
-- the table. Safe: nothing reads it anymore.
delete from public.active_games;

-- ---------------------------------------------------------------------------
-- 5. (Optional) Debug helper: peek at the rotation schedule for the next
--    24 hours. Returns (hour_index, entering, leaving) so an admin can
--    see exactly when each game swaps in/out. Useful for tests; the UI
--    doesn't need this.
-- ---------------------------------------------------------------------------
create or replace function public.rotation_preview(p_hours integer default 24)
returns table(hour_index bigint, at timestamptz, entering text, leaving text)
language plpgsql stable security definer set search_path = public as $$
declare
  pool     text[] := public.game_pool();
  n        int    := array_length(pool, 1);
  epoch    timestamptz := public._rotation_epoch();
  period   interval    := public._rotation_period();
  h0       bigint;
  i        int;
  h        bigint;
begin
  if p_hours < 1 or p_hours > 168 then raise exception 'hours 1..168'; end if;
  h0 := floor(extract(epoch from (now() - epoch)) / extract(epoch from period))::bigint;
  for i in 0..(p_hours - 1) loop
    h := h0 + i;
    hour_index := h;
    at         := epoch + (h * period);
    entering   := pool[(( h     ) % n + n) % n + 1];
    leaving    := pool[(((h - 6)) % n + n) % n + 1];
    return next;
  end loop;
end; $$;
grant execute on function public.rotation_preview(integer) to authenticated;

-- Done.
