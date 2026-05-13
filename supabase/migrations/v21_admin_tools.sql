alter table public.profiles
  add column if not exists is_banned boolean not null default false,
  add column if not exists banned_at timestamptz,
  add column if not exists banned_by uuid references public.profiles(id) on delete set null,
  add column if not exists ban_reason text;

create index if not exists profiles_is_banned_idx on public.profiles (is_banned) where is_banned;

drop policy if exists "profiles update self limited" on public.profiles;
create policy "profiles update self limited" on public.profiles
  for update using (auth.uid() = id)
  with check (
    auth.uid() = id
    and credits        = (select credits        from public.profiles where id = auth.uid())
    and is_admin       = (select is_admin       from public.profiles where id = auth.uid())
    and is_banned      = (select is_banned      from public.profiles where id = auth.uid())
    and streak_days    = (select streak_days    from public.profiles where id = auth.uid())
    and last_claim_date is not distinct from (select last_claim_date from public.profiles where id = auth.uid())
    and total_wagered  = (select total_wagered  from public.profiles where id = auth.uid())
    and total_won      = (select total_won      from public.profiles where id = auth.uid())
    and peak_credits   = (select peak_credits   from public.profiles where id = auth.uid())
    and biggest_single_win = (select biggest_single_win from public.profiles where id = auth.uid())
    and cases_opened   = (select cases_opened   from public.profiles where id = auth.uid())
    and items_unique   = (select items_unique   from public.profiles where id = auth.uid())
    and items_total    = (select items_total    from public.profiles where id = auth.uid())
    and gacha_pity     = (select gacha_pity     from public.profiles where id = auth.uid())
    and case_pity      = (select case_pity      from public.profiles where id = auth.uid())
    and banned_at is not distinct from (select banned_at from public.profiles where id = auth.uid())
    and banned_by is not distinct from (select banned_by from public.profiles where id = auth.uid())
    and ban_reason is not distinct from (select ban_reason from public.profiles where id = auth.uid())
  );

create or replace view public.v_leaderboard as
  select id, display_name, avatar_url,
         credits, peak_credits,
         total_wagered, total_won,
         biggest_single_win, cases_opened,
         items_unique, items_total
    from public.profiles
   where coalesce(is_banned, false) = false
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

create or replace function public._admin_assert()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  admin_flag boolean;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select coalesce(p.is_admin, false)
    into admin_flag
    from public.profiles p
   where p.id = uid;

  if not admin_flag then
    raise exception 'Admin access required';
  end if;
end;
$$;

revoke all on function public._admin_assert() from public;

create or replace function public._admin_apply_credit_delta(
  p_user uuid,
  p_delta integer,
  p_kind text,
  p_meta jsonb default '{}'::jsonb
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance integer;
begin
  update public.profiles
     set credits = credits + p_delta,
         peak_credits = greatest(peak_credits, credits + p_delta)
   where id = p_user
   returning credits into new_balance;

  if new_balance is null then
    raise exception 'Profile not found';
  end if;
  if new_balance < 0 then
    raise exception 'Insufficient credits';
  end if;

  insert into public.transactions (user_id, delta, balance_after, kind, meta)
  values (p_user, p_delta, new_balance, p_kind, p_meta);

  return new_balance;
end;
$$;

revoke all on function public._admin_apply_credit_delta(uuid,integer,text,jsonb) from public;

create or replace function public.admin_grant_credits(
  p_amount integer,
  p_target_user uuid default null,
  p_all boolean default false,
  p_zero_only boolean default false,
  p_note text default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  rec record;
  touched integer := 0;
begin
  perform public._admin_assert();

  if p_amount is null or p_amount < 1 then
    raise exception 'Amount must be positive';
  end if;
  if p_all and p_zero_only then
    raise exception 'Choose either all users or zero-credit users';
  end if;
  if p_target_user is null and not p_all and not p_zero_only then
    raise exception 'No target specified';
  end if;

  if p_target_user is not null then
    perform public._admin_apply_credit_delta(
      p_target_user,
      p_amount,
      'admin_grant',
      jsonb_build_object('admin_id', uid, 'scope', 'single', 'note', coalesce(p_note, ''))
    );
    return 1;
  end if;

  for rec in
    select id
      from public.profiles
     where case when p_zero_only then credits = 0 else true end
  loop
    perform public._admin_apply_credit_delta(
      rec.id,
      p_amount,
      'admin_grant',
      jsonb_build_object(
        'admin_id', uid,
        'scope', case when p_zero_only then 'zero_credit' else 'all_users' end,
        'note', coalesce(p_note, '')
      )
    );
    touched := touched + 1;
  end loop;

  return touched;
end;
$$;

revoke all on function public.admin_grant_credits(integer,uuid,boolean,boolean,text) from public;
grant execute on function public.admin_grant_credits(integer,uuid,boolean,boolean,text) to authenticated;

create or replace function public.admin_set_user_ban(
  p_user uuid,
  p_banned boolean,
  p_reason text default null
) returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  prof public.profiles%rowtype;
begin
  perform public._admin_assert();

  update public.profiles
     set is_banned = p_banned,
         banned_at = case when p_banned then now() else null end,
         banned_by = case when p_banned then uid else null end,
         ban_reason = case when p_banned then nullif(left(coalesce(p_reason, ''), 500), '') else null end
   where id = p_user
   returning * into prof;

  if not found then
    raise exception 'Profile not found';
  end if;

  return prof;
end;
$$;

revoke all on function public.admin_set_user_ban(uuid,boolean,text) from public;
grant execute on function public.admin_set_user_ban(uuid,boolean,text) to authenticated;

create or replace function public.admin_grant_collectible(
  p_item uuid,
  p_target_user uuid default null,
  p_all boolean default false,
  p_qty integer default 1,
  p_note text default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  it public.market_items%rowtype;
  rec record;
  touched integer := 0;
begin
  perform public._admin_assert();

  if p_qty is null or p_qty < 1 then
    raise exception 'Quantity must be positive';
  end if;
  if p_all and p_target_user is not null then
    raise exception 'Choose either a single user or all users';
  end if;
  if p_target_user is null and not p_all then
    raise exception 'No target specified';
  end if;

  select * into it from public.market_items where id = p_item;
  if not found then
    raise exception 'Item not found';
  end if;
  if it.category not in ('effect','frame','title','badge','trophy') then
    raise exception 'Item is not a collectible';
  end if;
  if it.is_unique and p_all then
    raise exception 'Unique collectibles can only be granted to a single user';
  end if;

  if p_target_user is not null then
    if it.is_unique then
      insert into public.user_items (user_id, item_id, qty, equipped)
      values (p_target_user, p_item, 1, false)
      on conflict (user_id, item_id) do update
        set qty = greatest(public.user_items.qty, 1);
    else
      insert into public.user_items (user_id, item_id, qty, equipped)
      values (p_target_user, p_item, p_qty, false)
      on conflict (user_id, item_id) do update
        set qty = public.user_items.qty + excluded.qty;
    end if;
    return 1;
  end if;

  for rec in select id from public.profiles loop
    if it.is_unique then
      insert into public.user_items (user_id, item_id, qty, equipped)
      values (rec.id, p_item, 1, false)
      on conflict (user_id, item_id) do update
        set qty = greatest(public.user_items.qty, 1);
    else
      insert into public.user_items (user_id, item_id, qty, equipped)
      values (rec.id, p_item, p_qty, false)
      on conflict (user_id, item_id) do update
        set qty = public.user_items.qty + excluded.qty;
    end if;
    touched := touched + 1;
  end loop;

  return touched;
end;
$$;

revoke all on function public.admin_grant_collectible(uuid,uuid,boolean,integer,text) from public;
grant execute on function public.admin_grant_collectible(uuid,uuid,boolean,integer,text) to authenticated;

create or replace function public.admin_reset_all_progress()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._admin_assert();

  execute '
    truncate table
      public.transactions,
      public.event_bets,
      public.events,
      public.emoji_hunts,
      public.case_openings,
      public.gacha_pulls,
      public.user_items,
      public.market_bids,
      public.market_listings,
      public.blackjack_hands,
      public.minesweeper_games,
      public.candy_spins,
      public.plinko_drops,
      public.lottery_draws,
      public.mp_games,
      public.warfront_games,
      public.leaderboard_reigns,
      public.user_achievements
    restart identity cascade';

  update public.gacha_pool
     set claimed_by = null,
         claimed_at = null
   where is_unique;

  update public.profiles
     set credits = 200,
         peak_credits = 200,
         total_wagered = 0,
         total_won = 0,
         biggest_single_win = 0,
         cases_opened = 0,
         items_unique = 0,
         items_total = 0,
         streak_days = 0,
         last_claim_date = null,
         case_pity = 0,
         gacha_pity = 0;
end;
$$;

revoke all on function public.admin_reset_all_progress() from public;
grant execute on function public.admin_reset_all_progress() to authenticated;

create or replace function public.leaderboard_tick()
returns void
language plpgsql security definer
set search_path = public as $$
declare
  reward integer := 5;
  top_uid uuid;
begin
  select id into top_uid from public.profiles
    where coalesce(is_banned, false) = false and credits > 0
    order by credits desc limit 1;
  perform public._kh_touch('credits', 'king_of_credits', top_uid, reward);

  select id into top_uid from public.profiles
    where coalesce(is_banned, false) = false and peak_credits > 0
    order by peak_credits desc limit 1;
  perform public._kh_touch('peak', 'king_of_peak', top_uid, reward);

  select id into top_uid from public.profiles
    where coalesce(is_banned, false) = false and biggest_single_win > 0
    order by biggest_single_win desc limit 1;
  perform public._kh_touch('biggest_win', 'king_of_biggest_win', top_uid, reward);

  select id into top_uid from public.profiles
    where coalesce(is_banned, false) = false and total_won > 0
    order by total_won desc limit 1;
  perform public._kh_touch('total_won', 'king_of_total_won', top_uid, reward);

  select id into top_uid from public.profiles
    where coalesce(is_banned, false) = false and total_wagered > 0
    order by total_wagered desc limit 1;
  perform public._kh_touch('total_wagered', 'king_of_total_wagered', top_uid, reward);

  select id into top_uid from public.profiles
    where coalesce(is_banned, false) = false and cases_opened > 0
    order by cases_opened desc limit 1;
  perform public._kh_touch('cases', 'king_of_cases', top_uid, reward);

  select id into top_uid from public.profiles
    where coalesce(is_banned, false) = false and items_unique > 0
    order by items_unique desc, items_total desc limit 1;
  perform public._kh_touch('collection', 'king_of_collection', top_uid, reward);
end; $$;

grant execute on function public.leaderboard_tick() to authenticated;
