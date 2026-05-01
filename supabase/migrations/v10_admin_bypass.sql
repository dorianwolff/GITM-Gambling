-- ============================================================================
-- v10_admin_bypass.sql
--   Lets admins bypass the 6-game rotation lock so they can test/play any
--   game at any time. We don't add a new helper function; we just redefine
--   is_game_active() so it short-circuits to TRUE when the caller has
--   profiles.is_admin = true. Every RPC that already calls is_game_active
--   (gacha_pull, minesweeper_*, candy_spin, the play_coinflip wrapper)
--   inherits the bypass for free.
--
-- Run AFTER v7 (which defines is_game_active and profiles.is_admin already
-- exists since v3). Idempotent: safe to re-run.
-- ============================================================================

-- We must change the function body, not the signature. CREATE OR REPLACE
-- preserves the (text)->boolean signature so dependent functions don't
-- need re-binding.
create or replace function public.is_game_active(g text)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  uid uuid := auth.uid();
  admin_flag boolean;
  in_rotation boolean;
begin
  -- Admin short-circuit: if the caller is an admin, every game is open
  -- to them regardless of the current 6-game rotation. This means admins
  -- can test new games (mines, candy, gacha…) without waiting for them
  -- to rotate in. Non-admins see the normal lockout.
  if uid is not null then
    select coalesce(p.is_admin, false) into admin_flag
      from public.profiles p where p.id = uid;
    if admin_flag then return true; end if;
  end if;

  select exists(
    select 1 from public.active_games
     where game_id = g and ends_at > now()
  ) into in_rotation;
  return in_rotation;
end;
$$;
grant execute on function public.is_game_active(text) to authenticated;

-- Done.
