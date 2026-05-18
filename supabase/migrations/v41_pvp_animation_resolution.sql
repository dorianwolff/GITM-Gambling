-- ============================================================================
-- v41_pvp_animation_resolution.sql
--
-- Changes PvP settlement so that the battle ANIMATION determines the winner
-- rather than a server-side random formula.
--
-- New flow:
--   1. wf_pvp_commit (both players)  → status = 'finished', winner = NULL
--   2. Each client runs the battle animation independently.
--   3. Animation ends → client calls wf_pvp_resolve(player_hp, opp_hp).
--      First call sets the winner (HP comparison); subsequent calls are
--      no-ops (idempotent).  Draw when both survive or both die.
--   4. Player clicks Surrender → client calls wf_pvp_surrender.
--      Surrendering player loses immediately regardless of animation state.
-- ============================================================================


-- ── 1. Rewrite wf_pvp_commit: remove score/payout block ──────────────────────

create or replace function public.wf_pvp_commit(
  p_game_id    uuid,
  p_picks      text[],
  p_collection text default 'fantasy'
) returns setof public.mp_warfront_games
language plpgsql security definer set search_path = public as $$
declare
  uid          uuid := auth.uid();
  g            public.mp_warfront_games%rowtype;
  v_units      jsonb;
  v_active_pool text[];
  v_id         text;
  v_u          jsonb;
  v_cost       int;
  v_total_cost int := 0;
  v_i          int;
  v_seat       text;
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

  -- Both committed → start animation phase (winner determined by animation).
  if g.x_ready and g.o_ready then
    update public.mp_warfront_games
       set status   = 'finished',
           ended_at = now()
     where id = p_game_id;
  end if;

  return query select * from public.mp_warfront_games where id = p_game_id;
end; $$;

grant execute on function public.wf_pvp_commit(uuid, text[], text) to authenticated;


-- ── 2. wf_pvp_resolve: animation result → winner + payout ────────────────────
-- Called by each client after their animation ends.
-- First call sets the winner (HP comparison); subsequent calls are no-ops.
-- Draw when both HP > 0 or both HP = 0 → each player gets their ante back.

create or replace function public.wf_pvp_resolve(
  p_game_id   uuid,
  p_player_hp integer,
  p_opp_hp    integer
) returns setof public.mp_warfront_games
language plpgsql security definer set search_path = public as $$
declare
  uid      uuid := auth.uid();
  g        public.mp_warfront_games%rowtype;
  v_seat   text;
  v_x_hp   integer;
  v_o_hp   integer;
  v_winner smallint;
  v_pot    integer;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  select * into g from public.mp_warfront_games where id = p_game_id for update;
  if not found then raise exception 'Game not found'; end if;
  if g.status <> 'finished' then
    raise exception 'Game is not in the animation phase';
  end if;

  -- Already resolved → idempotent return.
  if g.winner is not null then
    return query select * from public.mp_warfront_games where id = p_game_id;
    return;
  end if;

  -- Map caller's (player, opponent) HP to (x_hp, o_hp).
  if uid = g.player_x then
    v_seat := 'x'; v_x_hp := p_player_hp; v_o_hp := p_opp_hp;
  elsif uid = g.player_o then
    v_seat := 'o'; v_o_hp := p_player_hp; v_x_hp := p_opp_hp;
  else
    raise exception 'You are not in this game';
  end if;

  v_x_hp := greatest(coalesce(v_x_hp, 0), 0);
  v_o_hp := greatest(coalesce(v_o_hp, 0), 0);
  v_pot  := g.ante * 2;

  if v_x_hp > 0 and v_o_hp = 0 then
    -- Player X destroyed player O's base.
    v_winner := 0;
    perform public._apply_credit_delta(g.player_x, v_pot, 'game_mp',
      jsonb_build_object('phase','payout','game','warfront_pvp','room_id',p_game_id,
        'pot',v_pot,'reason','animation','x_hp',v_x_hp,'o_hp',v_o_hp));

  elsif v_o_hp > 0 and v_x_hp = 0 then
    -- Player O destroyed player X's base.
    v_winner := 1;
    perform public._apply_credit_delta(g.player_o, v_pot, 'game_mp',
      jsonb_build_object('phase','payout','game','warfront_pvp','room_id',p_game_id,
        'pot',v_pot,'reason','animation','x_hp',v_x_hp,'o_hp',v_o_hp));

  else
    -- Draw: both bases survived, or both were destroyed simultaneously.
    v_winner := -1;
    perform public._apply_credit_delta(g.player_x, g.ante, 'game_mp',
      jsonb_build_object('phase','draw_refund','game','warfront_pvp','room_id',p_game_id));
    perform public._apply_credit_delta(g.player_o, g.ante, 'game_mp',
      jsonb_build_object('phase','draw_refund','game','warfront_pvp','room_id',p_game_id));
  end if;

  update public.mp_warfront_games
     set winner        = v_winner,
         x_base_hp     = v_x_hp,
         o_base_hp     = v_o_hp,
         result_reason = 'animation'
   where id = p_game_id;

  return query select * from public.mp_warfront_games where id = p_game_id;
end; $$;

grant execute on function public.wf_pvp_resolve(uuid, integer, integer) to authenticated;


-- ── 3. wf_pvp_surrender: immediate loss for the calling player ────────────────

create or replace function public.wf_pvp_surrender(p_game_id uuid)
returns setof public.mp_warfront_games
language plpgsql security definer set search_path = public as $$
declare
  uid      uuid := auth.uid();
  g        public.mp_warfront_games%rowtype;
  v_winner smallint;
  v_pot    integer;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  select * into g from public.mp_warfront_games where id = p_game_id for update;
  if not found then raise exception 'Game not found'; end if;
  if g.status <> 'finished' then
    raise exception 'Game is not in the animation phase';
  end if;

  -- Already resolved → idempotent return.
  if g.winner is not null then
    return query select * from public.mp_warfront_games where id = p_game_id;
    return;
  end if;

  if uid = g.player_x then
    v_winner := 1;  -- O wins
  elsif uid = g.player_o then
    v_winner := 0;  -- X wins
  else
    raise exception 'You are not in this game';
  end if;

  v_pot := g.ante * 2;
  perform public._apply_credit_delta(
    case when v_winner = 0 then g.player_x else g.player_o end,
    v_pot, 'game_mp',
    jsonb_build_object('phase','payout','game','warfront_pvp','room_id',p_game_id,
      'pot',v_pot,'reason','surrender')
  );

  update public.mp_warfront_games
     set winner        = v_winner,
         x_base_hp     = case when v_winner = 0 then 10 + floor(random()*80)::int else 0 end,
         o_base_hp     = case when v_winner = 1 then 10 + floor(random()*80)::int else 0 end,
         result_reason = 'surrender'
   where id = p_game_id;

  return query select * from public.mp_warfront_games where id = p_game_id;
end; $$;

grant execute on function public.wf_pvp_surrender(uuid) to authenticated;


-- ============================================================================
-- Done.
-- ============================================================================
