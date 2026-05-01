-- ============================================================================
-- v16_rotation_ambig_fix.sql
--   v13's get_active_games triggers 42702
--     column reference "game_id" is ambiguous
--       (could refer to either a PL/pgSQL variable or a table column)
--
-- Why: v13 implemented the function with `returns table(game_id text, ...)`
-- plus `return next` inside a plpgsql loop. The OUT-param name `game_id`
-- collides in the returned-rowtype context with the `game_id` column on
-- `public.active_games` (still present in the schema from v7). In some
-- Postgres builds the compiler flags this as ambiguous even though the
-- body never references the table.
--
-- Fix: sidestep the OUT-param / row-type conflict entirely.
--   * Build the rotation set inline with a single RETURN QUERY over
--     `generate_series(0, 5)` and pool[] index arithmetic.
--   * No more RETURN NEXT, no per-row OUT-param writes.
--   * Rename the `epoch` local to `epoch_ts` so it never risks colliding
--     with the `extract(epoch from ...)` keyword in a reader's head.
--
-- Also re-issue `is_game_active` for symmetry (same naming hygiene) so
-- if the same ambiguity ever hit it we're covered.
--
-- Depends on: v13. Idempotent: safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. get_active_games — pure SQL, single RETURN QUERY.
-- ---------------------------------------------------------------------------
drop function if exists public.get_active_games();
create or replace function public.get_active_games()
returns table(game_id text, started_at timestamptz, ends_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  pool       text[] := public.game_pool();
  n          int    := array_length(pool, 1);
  active_n   int    := 6;
  epoch_ts   timestamptz := public._rotation_epoch();
  period     interval    := public._rotation_period();
  lifetime   interval    := public._rotation_lifetime();
  h_index    bigint;
begin
  if n is null or n = 0 then
    return;   -- empty pool → empty result
  end if;

  h_index := floor(
    extract(epoch from (now() - epoch_ts))
    / extract(epoch from period)
  )::bigint;

  -- If fewer than 6 games are configured, fall back to returning whatever's
  -- in the pool with a 6h lifetime each. The cap keeps us from emitting
  -- duplicates via the modulo.
  if n < active_n then
    return query
      select
        pool[(k % n) + 1]::text,
        now() - lifetime,
        now() + lifetime
      from generate_series(0, n - 1) as gs(k);
    return;
  end if;

  return query
    select
      pool[((h_index - k) % n + n)::bigint % n + 1]::text,
      (epoch_ts + ((h_index - k + active_n) * period)) - lifetime,
      (epoch_ts + ((h_index - k + active_n) * period))
    from generate_series(0, active_n - 1) as gs(k)
    order by 3 asc;
end; $$;
grant execute on function public.get_active_games() to authenticated;


-- ---------------------------------------------------------------------------
-- 2. is_game_active — same clock math, but we only need a boolean.
--    Re-issued with the same naming convention; admin bypass preserved.
-- ---------------------------------------------------------------------------
create or replace function public.is_game_active(g text)
returns boolean
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  uid        uuid := auth.uid();
  is_admin   boolean := false;
  pool       text[] := public.game_pool();
  n          int    := array_length(pool, 1);
  epoch_ts   timestamptz := public._rotation_epoch();
  period     interval    := public._rotation_period();
  h_index    bigint;
  k          int;
  slot_idx   int;
begin
  if uid is not null then
    select coalesce(p.is_admin, false) into is_admin
      from public.profiles p where p.id = uid;
    if is_admin then return true; end if;
  end if;

  if g is null or n is null or n = 0 then return false; end if;

  h_index := floor(
    extract(epoch from (now() - epoch_ts))
    / extract(epoch from period)
  )::bigint;

  for k in 0..5 loop
    slot_idx := ((h_index - k) % n + n)::bigint % n;
    if pool[slot_idx + 1] = g then return true; end if;
  end loop;
  return false;
end; $$;
grant execute on function public.is_game_active(text) to authenticated;

-- Done.
