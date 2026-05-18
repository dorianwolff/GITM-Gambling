-- ============================================================================
-- v44_server_pvp_and_rotation_fix.sql
--
-- 1. wf_pvp_commit: restore server-side resolution.
--    When both players commit, the server immediately scores both armies,
--    decides the winner (or draw), pays out, and sets winner ≠ null before
--    the row transitions to 'finished'.  The battle animation on each client
--    is purely cosmetic — the financial outcome is already settled.
--
--    Draw rule: if army scores are within 5% of each other AND random() < 0.3,
--    both players are refunded their ante (30% chance when armies are matched).
--
--    wf_pvp_resolve / wf_pvp_surrender both have an idempotent guard
--    (IF g.winner IS NOT NULL THEN RETURN) so they become no-ops once the
--    server has already resolved — no client-side changes needed.
--
-- 2. play_warfront: remove admin bypass for unit rotation.
--    All players, including admins, must pick from the current active pool.
-- ============================================================================


-- ── 1. wf_pvp_commit (server-side resolution) ────────────────────────────────

create or replace function public.wf_pvp_commit(
  p_game_id    uuid,
  p_picks      text[],
  p_collection text default 'fantasy'
) returns setof public.mp_warfront_games
language plpgsql security definer set search_path = public as $$
declare
  uid           uuid := auth.uid();
  g             public.mp_warfront_games%rowtype;
  v_units       jsonb;
  v_active_pool text[];
  v_id          text;
  v_u           jsonb;
  v_cost        int;
  v_total_cost  int := 0;
  v_i           int;
  v_seat        text;
  -- resolution
  v_x_score     numeric;
  v_o_score     numeric;
  v_margin      numeric;
  v_x_win_p     numeric;
  v_winner      smallint;
  v_win_uid     uuid;
  v_pot         integer;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_collection not in ('fantasy','animals') then
    raise exception 'Invalid collection: %', p_collection;
  end if;
  if array_length(p_picks,1) is null or array_length(p_picks,1) < 1
     or array_length(p_picks,1) > 6 then
    raise exception 'Pick between 1 and 6 units';
  end if;

  select * into g from public.mp_warfront_games where id = p_game_id for update;
  if not found then raise exception 'Room not found'; end if;
  if g.status <> 'drafting' then
    raise exception 'Room is not in drafting phase';
  end if;

  if uid = g.player_x then v_seat := 'x';
  elsif uid = g.player_o then v_seat := 'o';
  else raise exception 'You are not in this room';
  end if;

  -- Idempotent: already committed.
  if (v_seat = 'x' and g.x_ready) or (v_seat = 'o' and g.o_ready) then
    return query select * from public.mp_warfront_games where id = p_game_id;
    return;
  end if;

  -- Validate picks against active rotation pool and draft budget.
  v_units := case when p_collection = 'animals'
             then public._warfront_animal_units()
             else public._warfront_units() end;
  v_active_pool := public._warfront_active_pool(p_collection, 12);

  for v_i in 1..array_length(p_picks,1) loop
    v_id := p_picks[v_i];
    select u into v_u from jsonb_array_elements(v_units) u where u->>'id' = v_id;
    if v_u is null then
      raise exception 'Invalid unit: %', v_id;
    end if;
    if not (v_id = any(v_active_pool)) then
      raise exception 'Unit % is not in the current rotation', v_id;
    end if;
    v_cost := coalesce((v_u->>'cost')::int, 99);
    v_total_cost := v_total_cost + v_cost;
  end loop;
  if v_total_cost > 10 then
    raise exception 'Army cost % exceeds draft budget of 10g', v_total_cost;
  end if;

  -- Save picks and mark ready.
  if v_seat = 'x' then
    update public.mp_warfront_games
       set x_picks = p_picks, x_collection = p_collection, x_ready = true
     where id = p_game_id
     returning * into g;
  else
    update public.mp_warfront_games
       set o_picks = p_picks, o_collection = p_collection, o_ready = true
     where id = p_game_id
     returning * into g;
  end if;

  -- Both committed → resolve server-side immediately.
  if g.x_ready and g.o_ready then
    v_x_score := public._warfront_score(to_jsonb(g.x_picks), g.x_collection, true);
    v_o_score := public._warfront_score(to_jsonb(g.o_picks), g.o_collection, true);
    v_pot     := g.ante * 2;

    -- Draw: armies within 5% of each other, 30% chance.
    v_margin  := abs(v_x_score - v_o_score) / greatest(v_x_score + v_o_score + 100, 1);
    if v_margin < 0.05 and random() < 0.3 then
      v_winner := -1;
      perform public._apply_credit_delta(g.player_x, g.ante, 'mp_refund',
        jsonb_build_object('mp_id', p_game_id, 'reason', 'draw'));
      perform public._apply_credit_delta(g.player_o, g.ante, 'mp_refund',
        jsonb_build_object('mp_id', p_game_id, 'reason', 'draw'));

      update public.mp_warfront_games
         set status        = 'finished',
             winner        = -1,
             result_reason = 'draw',
             x_base_hp     = 10 + floor(random() * 60)::int,
             o_base_hp     = 10 + floor(random() * 60)::int,
             ended_at      = now()
       where id = p_game_id;
    else
      -- Probabilistic winner: 50% base ± 35% based on score margin.
      -- Clamped to [0.15, 0.85] so there is always a chance for an upset.
      v_margin   := (v_x_score - v_o_score) / greatest(v_x_score + v_o_score + 100, 1);
      v_x_win_p  := greatest(0.15, least(0.85, 0.5 + v_margin * 0.35));

      if random() < v_x_win_p then
        v_winner := 0;  -- X wins
      else
        v_winner := 1;  -- O wins
      end if;

      v_win_uid := case when v_winner = 0 then g.player_x else g.player_o end;
      perform public._apply_credit_delta(v_win_uid, v_pot, 'game_mp',
        jsonb_build_object(
          'phase',   'payout',
          'game',    'warfront_pvp',
          'room_id', p_game_id,
          'pot',     v_pot,
          'x_score', v_x_score,
          'o_score', v_o_score
        ));

      update public.mp_warfront_games
         set status        = 'finished',
             winner        = v_winner,
             result_reason = 'score',
             x_base_hp     = case when v_winner = 0 then 10 + floor(random()*80)::int else 0 end,
             o_base_hp     = case when v_winner = 1 then 10 + floor(random()*80)::int else 0 end,
             ended_at      = now()
       where id = p_game_id;
    end if;
  end if;

  return query select * from public.mp_warfront_games where id = p_game_id;
end; $$;

grant execute on function public.wf_pvp_commit(uuid, text[], text) to authenticated;


-- ── 2. play_warfront: all players must pick from active rotation ──────────────

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
  v_i int;
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
    -- All players (including admins) must pick from the current active rotation.
    if not (v_id = any(v_active_pool)) then
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


-- ============================================================================
-- Done.
-- ============================================================================
