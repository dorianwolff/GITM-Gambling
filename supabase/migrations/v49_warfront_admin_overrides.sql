-- ============================================================================
-- v49_warfront_admin_overrides.sql
--
-- Adds a singleton admin-override table for Warfront:
--   - Per-collection unit pool overrides (replaces automatic rotation)
--   - Per-unit stat overrides (hp, dmg, spd, atk_rate, cost) applied globally
--
-- Exposes two security-definer RPCs:
--   get_warfront_overrides()              → any authenticated/anon caller
--   admin_set_warfront_overrides(...)     → admin-only
-- ============================================================================

-- ── 1. Singleton table ────────────────────────────────────────────────────────

create table if not exists public.warfront_overrides (
  id            boolean primary key default true check (id = true),
  fantasy_pool  text[],
  animal_pool   text[],
  fantasy_stats jsonb   not null default '{}'::jsonb,
  animal_stats  jsonb   not null default '{}'::jsonb,
  updated_at    timestamptz not null default now()
);

insert into public.warfront_overrides (id) values (true) on conflict do nothing;

alter table public.warfront_overrides enable row level security;

create policy "no direct access" on public.warfront_overrides
  using (false) with check (false);

-- ── 2. Read RPC (game client + admin) ─────────────────────────────────────────

create or replace function public.get_warfront_overrides()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select row_to_json(r)
  from (
    select fantasy_pool, animal_pool, fantasy_stats, animal_stats
    from public.warfront_overrides
    where id = true
  ) r;
$$;

grant execute on function public.get_warfront_overrides() to authenticated, anon;

-- ── 3. Write RPC (admin only) ─────────────────────────────────────────────────

create or replace function public.admin_set_warfront_overrides(
  p_fantasy_pool  text[]  default null,
  p_animal_pool   text[]  default null,
  p_fantasy_stats jsonb   default null,
  p_animal_stats  jsonb   default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean;
begin
  select is_admin into v_admin
  from public.profiles
  where id = auth.uid();

  if not coalesce(v_admin, false) then
    raise exception 'Admin privileges required';
  end if;

  update public.warfront_overrides
     set fantasy_pool  = p_fantasy_pool,
         animal_pool   = p_animal_pool,
         fantasy_stats = coalesce(p_fantasy_stats, '{}'::jsonb),
         animal_stats  = coalesce(p_animal_stats,  '{}'::jsonb),
         updated_at    = now()
   where id = true;
end;
$$;

revoke all  on function public.admin_set_warfront_overrides(text[], text[], jsonb, jsonb) from public;
grant execute on function public.admin_set_warfront_overrides(text[], text[], jsonb, jsonb) to service_role, authenticated;

-- ============================================================================
-- Done.
-- ============================================================================
