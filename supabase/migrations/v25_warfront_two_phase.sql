-- v25_warfront_two_phase.sql
-- Two-phase warfront: deduct on play, pay out only after animation resolves.
-- Fixes _warfront_score float casts, adds resolved column, biased enemy army.

-- ── Fix _warfront_score: all float-capable fields use ::numeric ───────────────

drop function if exists public._warfront_score(jsonb, text, boolean);

create or replace function public._warfront_score(p_army jsonb, p_collection text, p_is_player boolean)
returns numeric language plpgsql as $$
declare
  v_units jsonb := case when p_collection = 'animals' then public._warfront_animal_units() else public._warfront_units() end;
  v_score numeric := 0;
  v_id text;
  v_u jsonb;
  v_hp numeric; v_dmg numeric; v_spd numeric;
  v_rate numeric; v_val numeric;
  v_has_warlord boolean := false;
  v_has_shaman int := 0;
  v_has_necro boolean := false;
  v_arr text[];
begin
  select array_agg(x) into v_arr from jsonb_array_elements_text(p_army) x;
  for v_i in 1..coalesce(array_length(v_arr,1),0) loop
    v_id := v_arr[v_i];
    select u from jsonb_array_elements(v_units) u where u->>'id' = v_id into v_u;
    if v_u is null then continue; end if;
    v_hp  := coalesce((v_u->>'hp')::numeric, 0);
    v_dmg := coalesce((v_u->>'dmg')::numeric, 0);
    v_spd := coalesce((v_u->>'spd')::numeric, 50);
    v_rate := greatest(coalesce((v_u->>'atk_rate')::numeric, 1), 0.5);
    v_val := (v_hp * v_dmg) / v_rate;
    v_val := v_val * least(v_spd / 100.0, 1.5);
    if coalesce((v_u->>'healer')::boolean, false) then v_val := v_val * 1.4; end if;
    if coalesce((v_u->>'aoe')::numeric, 0) > 0 then v_val := v_val * 1.25; end if;
    if coalesce((v_u->>'trample')::boolean, false) then v_val := v_val * 1.15; end if;
    if coalesce((v_u->>'phoenix')::boolean, false) then v_val := v_val * 1.2; end if;
    -- handle both field name variants (animals vs fantasy)
    if coalesce((v_u->>'regen')::numeric, (v_u->>'regenPerSec')::numeric, 0) > 0 then v_val := v_val * 1.1; end if;
    if coalesce((v_u->>'reflect')::numeric, (v_u->>'reflectPct')::numeric, 0) > 0 then v_val := v_val * 1.1; end if;
    if coalesce((v_u->>'slow')::numeric, (v_u->>'slowDur')::numeric, 0) > 0 then v_val := v_val * 1.05; end if;
    if coalesce((v_u->>'assassin')::boolean, false) then v_val := v_val * 1.2; end if;
    if coalesce((v_u->>'can_air')::boolean, false) and not coalesce((v_u->>'ranged')::boolean, false) then
      v_val := v_val * 1.15;
    end if;
    if v_id = 'warlord' then v_has_warlord := true; end if;
    if v_id = 'shaman' then v_has_shaman := v_has_shaman + 1; end if;
    if v_id = 'necromancer' then v_has_necro := true; end if;
    v_score := v_score + v_val;
  end loop;
  if v_has_warlord then v_score := v_score * 1.15; end if;
  if v_has_shaman > 0 then v_score := v_score * (1 + v_has_shaman * 0.08); end if;
  if v_has_necro then v_score := v_score * 1.05; end if;
  return v_score;
end;
$$;

-- ── Add resolved column (idempotent) ─────────────────────────────────────────

alter table public.warfront_games
  add column if not exists resolved boolean not null default false;

-- ── Enemy army with player-picks bias (3-param, drops 2-param) ───────────────

drop function if exists public._warfront_enemy_army(integer, text);
drop function if exists public._warfront_enemy_army(integer, text, text[]);

create or replace function public._warfront_enemy_army(
  p_budget int,
  p_collection text default 'fantasy',
  p_player_picks text[] default '{}'
) returns jsonb language plpgsql stable as $$
declare
  v_units jsonb := case when p_collection = 'animals' then public._warfront_animal_units() else public._warfront_units() end;
  v_ids text[] := public._warfront_active_pool(p_collection, 12);
  v_army text[] := '{}';
  v_budget int := p_budget;
  v_cost int;
  v_id text;
  v_u jsonb;
  v_has_ranged boolean := false;
  v_tries int := 0;
begin
  while v_budget > 0 and v_tries < 300 loop
    v_tries := v_tries + 1;
    v_id := v_ids[1+floor(random()*array_length(v_ids,1))::int];
    -- 50% skip bias: reduce (but not eliminate) mirroring the player's picks
    if v_id = any(p_player_picks) and random() < 0.5 then continue; end if;
    select u from jsonb_array_elements(v_units) u where u->>'id' = v_id into v_u;
    v_cost := coalesce((v_u->>'cost')::int, 99);
    if v_cost > v_budget then
      v_id := case when p_collection = 'animals'
        then (case when random()<0.5 then 'rat' else 'wolfpack' end)
        else (case when random()<0.5 then 'footman' else 'peasant' end)
      end;
      if not (v_id = any(v_ids)) then exit; end if;
      select u from jsonb_array_elements(v_units) u where u->>'id' = v_id into v_u;
      v_cost := coalesce((v_u->>'cost')::int, 99);
      if v_cost > v_budget then exit; end if;
    end if;
    v_army := array_append(v_army, v_id);
    v_budget := v_budget - v_cost;
    if coalesce((v_u->>'ranged')::boolean, false) or coalesce((v_u->>'can_air')::boolean, false) then
      v_has_ranged := true;
    end if;
  end loop;
  -- ensure at least one ranged/air unit
  if not v_has_ranged and array_length(v_army,1) > 0 then
    select u->>'id' into v_id
      from jsonb_array_elements(v_units) u
      where u->>'id' = any(v_ids)
        and (coalesce((u->>'ranged')::boolean, false) or coalesce((u->>'can_air')::boolean, false))
      limit 1;
    if v_id is not null then v_army[1] := v_id; end if;
  end if;
  return to_jsonb(v_army);
end;
$$;

-- ── Two-phase play_warfront: bet deducted now, payout deferred ───────────────

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
    if not (v_id = any(v_active_pool)) then
      raise exception 'Unit % is not in the current rotation', v_id;
    end if;
    v_total_cost := v_total_cost + (v_u->>'cost')::int;
  end loop;
  if v_total_cost > p_draft_budget then
    raise exception 'Unit cost % exceeds draft budget %', v_total_cost, p_draft_budget;
  end if;
  -- deduct bet upfront
  perform public._apply_credit_delta(v_user_id, -p_bet, 'warfront',
    jsonb_build_object('phase','wager','picks',to_jsonb(p_picks),'collection',p_collection,'draft_budget',p_draft_budget));
  -- generate enemy
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
  -- insert unresolved record (HP/payout filled in by resolve_warfront)
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

-- ── resolve_warfront: called after animation, applies payout ─────────────────

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
  -- win is determined server-side: enemy dead and player alive
  v_won := (p_enemy_base_hp = 0 and p_player_base_hp > 0);
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
    -- perfect win bonus: enemy at 0, player at full 100
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
