-- v31_mp_result_reason_and_rotation_admin.sql
--
-- Fix 1: add missing `result_reason` column to mp_games.
--   _mp_finalize (v5, v29) already references this column in its UPDATE but
--   it was never added to the table definition in v3. Every resign / timeout
--   call to _mp_finalize therefore threw:
--     "column result_reason of relation mp_games does not exist"
--
-- Fix 2: admin rotation-advance control.
--   The deterministic rotation (v13) lets admins force a single-slot advance
--   by storing an integer offset in a singleton config row. Both
--   get_active_games() and is_game_active() add this offset to the computed
--   hour-index so the whole server sees the shift instantly.
--
--   Important UX note (enforced by the SPA architecture, not by server code):
--   requireActiveGame() guards only fire on page navigation, not continuously.
--   Players who are already mid-game when an admin advances the rotation will
--   finish their session naturally and collect any winnings before the guard
--   redirects them on their next navigation. No server-side kick is needed.


-- ── 1. mp_games.result_reason ────────────────────────────────────────────────

alter table public.mp_games
  add column if not exists result_reason text;


-- ── 2. rotation_config singleton ─────────────────────────────────────────────

create table if not exists public.rotation_config (
  id          int  primary key default 1 check (id = 1),   -- singleton row
  extra_slots int  not null    default 0,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id)
);

-- Insert the row if it doesn't exist (idempotent).
insert into public.rotation_config (id, extra_slots)
  values (1, 0)
  on conflict (id) do nothing;

-- Admins can see it; only the server writes it.
alter table public.rotation_config enable row level security;
drop policy if exists "rotation_config read all" on public.rotation_config;
create policy "rotation_config read all" on public.rotation_config
  for select using (true);


-- ── 3. Rebuild get_active_games() with extra_slots support ───────────────────

drop function if exists public.get_active_games();
create or replace function public.get_active_games()
returns table(game_id text, started_at timestamptz, ends_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  pool       text[]      := public.game_pool();
  n          int         := array_length(pool, 1);
  active_n   int         := 6;
  epoch      timestamptz := public._rotation_epoch();
  period     interval    := public._rotation_period();
  lifetime   interval    := public._rotation_lifetime();
  h_index    bigint;
  extra      bigint;
  k          int;
  slot_idx   int;
  ea         timestamptz;
begin
  if n is null or n < active_n then
    for k in 1..coalesce(n,0) loop
      game_id    := pool[k];
      started_at := now();
      ends_at    := now() + lifetime;
      return next;
    end loop;
    return;
  end if;

  -- Read the admin-controlled slot offset (0 by default).
  select coalesce(rc.extra_slots, 0) into extra
    from public.rotation_config rc where rc.id = 1;
  extra := coalesce(extra, 0);

  h_index := floor(extract(epoch from (now() - epoch))
               / extract(epoch from period))::bigint + extra;

  for k in reverse (active_n - 1)..0 loop
    slot_idx   := ((h_index - k) % n + n) % n;
    game_id    := pool[slot_idx + 1];
    ea         := epoch + ((h_index - k + active_n) * period);
    started_at := ea - lifetime;
    ends_at    := ea;
    return next;
  end loop;
end; $$;

grant execute on function public.get_active_games() to authenticated;


-- ── 4. Rebuild is_game_active() with extra_slots support ─────────────────────

drop function if exists public.is_game_active(text);
create or replace function public.is_game_active(g text)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  uid      uuid    := auth.uid();
  is_admin boolean := false;
  pool     text[]  := public.game_pool();
  n        int     := array_length(pool, 1);
  epoch    timestamptz := public._rotation_epoch();
  period   interval    := public._rotation_period();
  h_index  bigint;
  extra    bigint;
  k        int;
  slot_idx int;
begin
  -- Admin bypass: admins can always open any game for testing.
  if uid is not null then
    select coalesce(p.is_admin, false) into is_admin
      from public.profiles p where p.id = uid;
    if is_admin then return true; end if;
  end if;

  if g is null or n is null or n = 0 then return false; end if;

  select coalesce(rc.extra_slots, 0) into extra
    from public.rotation_config rc where rc.id = 1;
  extra := coalesce(extra, 0);

  h_index := floor(extract(epoch from (now() - epoch))
               / extract(epoch from period))::bigint + extra;

  for k in 0..5 loop
    slot_idx := ((h_index - k) % n + n) % n;
    if pool[slot_idx + 1] = g then return true; end if;
  end loop;
  return false;
end; $$;

grant execute on function public.is_game_active(text) to authenticated;


-- ── 5. admin_advance_rotation() ──────────────────────────────────────────────
-- Increments extra_slots by p_steps (default 1) and returns the new rotation.

create or replace function public.admin_advance_rotation(p_steps integer default 1)
returns table(game_id text, started_at timestamptz, ends_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  uid      uuid    := auth.uid();
  is_admin boolean := false;
begin
  select coalesce(p.is_admin, false) into is_admin
    from public.profiles p where p.id = uid;
  if not is_admin then raise exception 'Admins only'; end if;
  if p_steps < 1 or p_steps > 100 then raise exception 'Steps must be 1..100'; end if;

  update public.rotation_config
     set extra_slots = extra_slots + p_steps,
         updated_at  = now(),
         updated_by  = uid
   where id = 1;

  return query select * from public.get_active_games();
end; $$;

grant execute on function public.admin_advance_rotation(integer) to authenticated;


-- ── 6. admin_reset_rotation_offset() ─────────────────────────────────────────
-- Resets extra_slots to 0 (back to wall-clock rotation).

create or replace function public.admin_reset_rotation_offset()
returns table(game_id text, started_at timestamptz, ends_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  uid      uuid    := auth.uid();
  is_admin boolean := false;
begin
  select coalesce(p.is_admin, false) into is_admin
    from public.profiles p where p.id = uid;
  if not is_admin then raise exception 'Admins only'; end if;

  update public.rotation_config
     set extra_slots = 0,
         updated_at  = now(),
         updated_by  = uid
   where id = 1;

  return query select * from public.get_active_games();
end; $$;

grant execute on function public.admin_reset_rotation_offset() to authenticated;


-- ── 7. admin_get_rotation() ──────────────────────────────────────────────────
-- Returns current active games + the current extra_slots offset.

create or replace function public.admin_get_rotation()
returns table(
  game_id     text,
  started_at  timestamptz,
  ends_at     timestamptz,
  extra_slots int
)
language plpgsql stable security definer set search_path = public as $$
declare
  uid      uuid    := auth.uid();
  is_admin boolean := false;
  v_extra  int;
begin
  select coalesce(p.is_admin, false) into is_admin
    from public.profiles p where p.id = uid;
  if not is_admin then raise exception 'Admins only'; end if;

  select coalesce(rc.extra_slots, 0) into v_extra
    from public.rotation_config rc where rc.id = 1;

  return query
    select g.game_id, g.started_at, g.ends_at, v_extra
      from public.get_active_games() g;
end; $$;

grant execute on function public.admin_get_rotation() to authenticated;
