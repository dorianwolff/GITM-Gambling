-- ============================================================================
-- v47_bigint_credits.sql
--
-- Widens the credits economy from 32-bit integer (max ~2.1 B) to 64-bit
-- bigint (max ~9.2 × 10^18) so large balances and payouts never overflow.
--
-- Affected columns:
--   profiles.credits, profiles.peak_credits    integer → bigint
--   transactions.delta, transactions.balance_after  integer → bigint
-- Affected functions:
--   _apply_credit_delta, _admin_apply_credit_delta  → bigint params/return
-- ============================================================================

-- ── 1. Drop all dependents blocking the ALTER COLUMN ─────────────────────────

drop policy if exists "profiles update self limited" on public.profiles;

drop view if exists public.v_leaderboard;
drop view if exists public.v_lb_peak;
drop view if exists public.v_lb_biggest_win;
drop view if exists public.v_lb_total_won;
drop view if exists public.v_lb_total_wagered;
drop view if exists public.v_lb_cases;
drop view if exists public.v_lb_collection;
drop view if exists public.v_lb_weekly_credits;

-- ── 2. Widen columns ─────────────────────────────────────────────────────────

alter table public.profiles
  alter column credits      type bigint using credits::bigint,
  alter column peak_credits type bigint using peak_credits::bigint;

alter table public.transactions
  alter column delta         type bigint using delta::bigint,
  alter column balance_after type bigint using balance_after::bigint;

-- ── 3. Recreate views ────────────────────────────────────────────────────────

create or replace view public.v_leaderboard as
  select id, display_name, avatar_url, credits, total_wagered, total_won
    from public.profiles
   order by credits desc
   limit 100;

create or replace view public.v_lb_peak as
  select id, display_name, avatar_url,
         peak_credits as value, credits, total_won, biggest_single_win
    from public.profiles
   where coalesce(is_banned, false) = false
   order by peak_credits desc
   limit 100;

create or replace view public.v_lb_biggest_win as
  select id, display_name, avatar_url,
         biggest_single_win as value, credits, peak_credits, total_won
    from public.profiles
   where coalesce(is_banned, false) = false
   order by biggest_single_win desc
   limit 100;

create or replace view public.v_lb_total_won as
  select id, display_name, avatar_url,
         total_won as value, credits, peak_credits, biggest_single_win
    from public.profiles
   where coalesce(is_banned, false) = false
   order by total_won desc
   limit 100;

create or replace view public.v_lb_total_wagered as
  select id, display_name, avatar_url,
         total_wagered as value, credits, peak_credits, total_won
    from public.profiles
   where coalesce(is_banned, false) = false
   order by total_wagered desc
   limit 100;

create or replace view public.v_lb_cases as
  select id, display_name, avatar_url,
         cases_opened as value, credits, biggest_single_win, items_unique
    from public.profiles
   where coalesce(is_banned, false) = false
     and cases_opened > 0
   order by cases_opened desc
   limit 100;

create or replace view public.v_lb_collection as
  select id, display_name, avatar_url,
         items_unique as value, items_total, credits, peak_credits
    from public.profiles
   where coalesce(is_banned, false) = false
     and items_unique > 0
   order by items_unique desc, items_total desc
   limit 100;

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

grant select on public.v_leaderboard       to authenticated, anon;
grant select on public.v_lb_peak           to authenticated, anon;
grant select on public.v_lb_biggest_win    to authenticated, anon;
grant select on public.v_lb_total_won      to authenticated, anon;
grant select on public.v_lb_total_wagered  to authenticated, anon;
grant select on public.v_lb_cases         to authenticated, anon;
grant select on public.v_lb_collection    to authenticated, anon;
grant select on public.v_lb_weekly_credits to authenticated, anon;

-- ── 4. Recreate RLS policy ────────────────────────────────────────────────────

create policy "profiles update self limited" on public.profiles
  for update using (auth.uid() = id)
  with check (
    auth.uid() = id
    and credits        = (select credits        from public.profiles where id = auth.uid())
    and is_admin       = (select is_admin       from public.profiles where id = auth.uid())
    and streak_days    = (select streak_days    from public.profiles where id = auth.uid())
    and last_claim_date is not distinct from (select last_claim_date from public.profiles where id = auth.uid())
    and total_wagered  = (select total_wagered  from public.profiles where id = auth.uid())
  );

-- ── 5. Recreate _apply_credit_delta with bigint ───────────────────────────────

create or replace function public._apply_credit_delta(
  p_user  uuid,
  p_delta bigint,
  p_kind  text,
  p_meta  jsonb default '{}'::jsonb
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  new_balance bigint;
  week_start  date := public.weekly_leaderboard_start();
begin
  update public.profiles
     set credits      = credits + p_delta,
         total_wagered = total_wagered + greatest(-p_delta, 0),
         total_won     = total_won     + greatest( p_delta, 0),
         peak_credits  = greatest(peak_credits, credits + p_delta),
         weekly_credits_earned = case
           when p_delta > 0 and weekly_credits_window_start = week_start then weekly_credits_earned + p_delta
           when p_delta > 0 then p_delta
           when weekly_credits_window_start = week_start then weekly_credits_earned
           else 0
         end,
         weekly_credits_window_start = week_start
   where id = p_user
   returning credits into new_balance;

  if new_balance is null then raise exception 'Profile not found'; end if;
  if new_balance < 0    then raise exception 'Insufficient credits'; end if;

  insert into public.transactions (user_id, delta, balance_after, kind, meta)
  values (p_user, p_delta, new_balance, p_kind, p_meta);

  return new_balance;
end;
$$;

revoke all  on function public._apply_credit_delta(uuid, bigint, text, jsonb) from public;
grant execute on function public._apply_credit_delta(uuid, bigint, text, jsonb) to service_role;

-- ── 6. Recreate _admin_apply_credit_delta with bigint ────────────────────────

create or replace function public._admin_apply_credit_delta(
  p_user  uuid,
  p_delta bigint,
  p_kind  text,
  p_meta  jsonb default '{}'::jsonb
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  new_balance bigint;
  week_start  date := public.weekly_leaderboard_start();
begin
  update public.profiles
     set credits      = credits + p_delta,
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

  if new_balance is null then raise exception 'Profile not found'; end if;

  insert into public.transactions (user_id, delta, balance_after, kind, meta)
  values (p_user, p_delta, new_balance, p_kind, p_meta);

  return new_balance;
end;
$$;

revoke all  on function public._admin_apply_credit_delta(uuid, bigint, text, jsonb) from public;
grant execute on function public._admin_apply_credit_delta(uuid, bigint, text, jsonb) to service_role, authenticated;

-- ============================================================================
-- Done.
-- ============================================================================
