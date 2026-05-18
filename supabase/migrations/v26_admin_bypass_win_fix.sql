-- v26_admin_bypass_win_fix.sql
-- 1. Win condition: player wins if playerHp > enemyHp (not just enemy=0)
-- 2. play_warfront: admins bypass the rotation check so they can test any unit

-- ── Fix resolve_warfront win condition ────────────────────────────────────────

drop function if exists public.resolve_warfront(uuid, integer, integer);

create or replace function public.resolve_warfront(
  p_game_id uuid,
  p_player_base_hp integer,
  p_enemy_base_hp integer
) returns table (
  new_balance integer,
  multiplier numeric,
  payout integer,
  won boolean
) language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
  v_game public.warfront_games%rowtype;
  v_won boolean;
  v_mult numeric := 0;
  v_payout int := 0;
  v_balance int;
begin
  select * into v_game from public.warfront_games
  where id = p_game_id and user_id = v_user_id;
  if not found then raise exception 'Game not found'; end if;
  if v_game.resolved then raise exception 'Game already resolved'; end if;

  -- Player wins if they have strictly more HP (tie = loss)
  v_won := (p_player_base_hp > p_enemy_base_hp);

  if v_won then
    v_mult := case v_game.enemy_difficulty
      when 'Easy'       then 1.2
      when 'Normal'     then 1.5
      when 'Hard'       then 2.0
      when 'Brutal'     then 3.0
      when 'Legendary'  then 5.0
      when 'Impossible' then 10.0
      else 1.2
    end;
    -- perfect win bonus: player base untouched
    if p_player_base_hp >= 100 then v_mult := v_mult * 1.5; end if;
    v_payout := floor(v_game.bet * v_mult)::int;
    if v_payout > 0 then
      perform public._apply_credit_delta(v_user_id, v_payout, 'warfront',
        jsonb_build_object('phase','reward','game_id',p_game_id,
          'player_base_hp',p_player_base_hp,'enemy_base_hp',p_enemy_base_hp,
          'multiplier',v_mult,'enemy_difficulty',v_game.enemy_difficulty));
    end if;
  end if;

  update public.warfront_games set
    resolved = true,
    player_base_hp = p_player_base_hp,
    enemy_base_hp = p_enemy_base_hp,
    multiplier = v_mult,
    payout = v_payout
  where id = p_game_id;

  select credits into v_balance from public.profiles where id = v_user_id;
  return query select v_balance, v_mult, v_payout, v_won;
end;
$$;

grant execute on function public.resolve_warfront(uuid, integer, integer) to authenticated;

-- ── Fix play_warfront: admins skip rotation check ─────────────────────────────

drop function if exists public.play_warfront(integer, text[], text, integer);

create or replace function public.play_warfront(
  p_bet integer,
  p_picks text[],
  p_collection text default 'fantasy',
  p_draft_budget integer default 10
) returns table (
  game_id uuid,
  enemy_army jsonb,
  enemy_difficulty text,
  enemy_budget integer
) language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
  v_is_admin boolean;
  v_total_cost int := 0;
  v_u jsonb;
  v_id text;
  v_e_budget int;
  v_e_army jsonb;
  v_diff_name text;
  v_game_id uuid;
  v_active_pool text[];
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  if p_bet < 10 then raise exception 'Bet must be at least 10'; end if;
  if array_length(p_picks,1) is null or array_length(p_picks,1) > 6 then
    raise exception 'Pick between 1 and 6 units';
  end if;
  if p_collection not in ('fantasy','animals') then
    raise exception 'Invalid collection: %', p_collection;
  end if;

  -- Check admin status once
  select coalesce(is_admin, false) into v_is_admin
  from public.profiles where id = v_user_id;

  v_active_pool := public._warfront_active_pool(p_collection, 12);

  for v_i in 1..array_length(p_picks,1) loop
    v_id := p_picks[v_i];
    select u from jsonb_array_elements(
      case when p_collection = 'animals' then public._warfront_animal_units() else public._warfront_units() end
    ) u where u->>'id' = v_id into v_u;
    if v_u is null then raise exception 'Invalid unit: %', v_id; end if;
    if coalesce(v_u->>'collection','fantasy') <> p_collection then
      raise exception 'Unit % does not belong to collection %', v_id, p_collection;
    end if;
    -- Admins bypass rotation; regular players must pick from active pool
    if not v_is_admin and not (v_id = any(v_active_pool)) then
      raise exception 'Unit % is not in the current rotation', v_id;
    end if;
    v_total_cost := v_total_cost + (v_u->>'cost')::int;
  end loop;

  if v_total_cost > p_draft_budget then
    raise exception 'Unit cost % exceeds draft budget %', v_total_cost, p_draft_budget;
  end if;

  -- Deduct bet upfront
  perform public._apply_credit_delta(v_user_id, -p_bet, 'warfront',
    jsonb_build_object('phase','wager','picks',to_jsonb(p_picks),'collection',p_collection,'draft_budget',p_draft_budget));

  -- Generate enemy
  v_e_budget := p_draft_budget + case
    when random() < 0.15 then 1
    when random() < 0.30 then 2
    when random() < 0.55 then 3
    when random() < 0.80 then 4
    else 5
  end;
  v_e_army := public._warfront_enemy_army(v_e_budget, p_collection, p_picks);
  v_diff_name := case
    when v_e_budget <= p_draft_budget + 1 then 'Easy'
    when v_e_budget =  p_draft_budget + 2 then 'Normal'
    when v_e_budget =  p_draft_budget + 3 then 'Hard'
    when v_e_budget =  p_draft_budget + 4 then 'Brutal'
    when v_e_budget =  p_draft_budget + 5 then 'Legendary'
    else 'Impossible'
  end;

  insert into public.warfront_games
    (user_id, bet, player_picks, formation, collection, enemy_difficulty, enemy_budget, enemy_army,
     player_base_hp, enemy_base_hp, multiplier, payout, battle_log, resolved)
  values
    (v_user_id, p_bet, to_jsonb(p_picks), null, p_collection, v_diff_name, v_e_budget, v_e_army,
     0, 0, 0, 0, '[]'::jsonb, false)
  returning id into v_game_id;

  return query select v_game_id, v_e_army, v_diff_name, v_e_budget;
end;
$$;

grant execute on function public.play_warfront(integer, text[], text, integer) to authenticated;
