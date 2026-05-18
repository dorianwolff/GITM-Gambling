-- ============================================================================
-- v45_pvp_collection_choice.sql
--
-- Adds per-room collection mode to Warfront PvP.
-- When creating a room the host picks:
--   'fantasy' — both players must draft from the Fantasy pool
--   'animals'  — both players must draft from the Animals pool
--   'mixed'    — each player independently picks Fantasy or Animals
--
-- Schema:
--   mp_warfront_games.room_collection text not null default 'fantasy'
--
-- Affected functions (all rewritten here so they supersede earlier versions):
--   wf_pvp_create  — accepts p_collection; stores it as room_collection
--   wf_pvp_commit  — enforces room_collection; full server-side resolution
--                    (carries forward v44 scoring logic)
--   wf_pvp_open_rooms — returns room_collection for lobby display
-- ============================================================================


-- ── 1. Add room_collection column ────────────────────────────────────────────

alter table public.mp_warfront_games
  add column if not exists room_collection text not null default 'fantasy'
    check (room_collection in ('fantasy','animals','mixed'));


-- ── 2. wf_pvp_create: accept collection choice ───────────────────────────────
-- Drop the old single-arg overload so there is no ambiguity.
drop function if exists public.wf_pvp_create(integer);

create or replace function public.wf_pvp_create(
  p_ante       integer,
  p_collection text default 'fantasy'
)
returns setof public.mp_warfront_games
language plpgsql security definer set search_path = public as $$
declare
  uid     uuid := auth.uid();
  prof    public.profiles%rowtype;
  game_id uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not public.is_game_active('warfront') then
    raise exception 'Warfront is not in the current rotation';
  end if;
  if p_ante < 10 or p_ante > 10000 then
    raise exception 'Ante must be between 10 and 10000';
  end if;
  if p_collection not in ('fantasy','animals','mixed') then
    raise exception 'Collection must be fantasy, animals, or mixed';
  end if;

  -- One open room per player.
  if exists (
    select 1 from public.mp_warfront_games
    where player_x = uid and status in ('waiting','drafting')
  ) then
    raise exception 'You already have an open Warfront PvP room';
  end if;

  select * into prof from public.profiles where id = uid for update;
  if prof.credits < p_ante then
    raise exception 'Not enough credits (need %)', p_ante;
  end if;

  perform public._apply_credit_delta(uid, -p_ante, 'game_mp',
    jsonb_build_object('phase','ante','game','warfront_pvp'));

  insert into public.mp_warfront_games (ante, player_x, room_collection)
    values (p_ante, uid, p_collection)
    returning id into game_id;

  return query select * from public.mp_warfront_games where id = game_id;
end; $$;

grant execute on function public.wf_pvp_create(integer, text) to authenticated;


-- ── 3. wf_pvp_commit: enforce room_collection + server-side resolution ────────
-- Carries forward v44 scoring logic.  Added: validate p_collection against
-- room_collection before saving picks.

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

  -- Enforce room collection mode.
  if g.room_collection = 'fantasy' and p_collection <> 'fantasy' then
    raise exception 'This room only allows the Fantasy collection';
  end if;
  if g.room_collection = 'animals' and p_collection <> 'animals' then
    raise exception 'This room only allows the Animals collection';
  end if;
  -- room_collection = 'mixed' → any collection is accepted.

  if uid = g.player_x then v_seat := 'x';
  elsif uid = g.player_o then v_seat := 'o';
  else raise exception 'You are not in this room';
  end if;

  -- Idempotent: already committed.
  if (v_seat = 'x' and g.x_ready) or (v_seat = 'o' and g.o_ready) then
    return query select * from public.mp_warfront_games where id = p_game_id;
    return;
  end if;

  -- Validate picks against the active pool for the chosen collection.
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

  -- Both committed → server-side resolution.
  if g.x_ready and g.o_ready then
    v_x_score := public._warfront_score(to_jsonb(g.x_picks), g.x_collection, true);
    v_o_score := public._warfront_score(to_jsonb(g.o_picks), g.o_collection, true);
    v_pot     := g.ante * 2;

    -- Draw: armies within 5% of each other, 30% chance.
    v_margin := abs(v_x_score - v_o_score) / greatest(v_x_score + v_o_score + 100, 1);
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
      -- Probabilistic winner: 50% base ±35% based on score margin.
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


-- ── 4. wf_pvp_open_rooms: include room_collection ────────────────────────────
drop function if exists public.wf_pvp_open_rooms();

create or replace function public.wf_pvp_open_rooms()
returns table (
  id              uuid,
  ante            integer,
  player_x        uuid,
  x_name          text,
  room_collection text,
  created_at      timestamptz
)
language sql security definer set search_path = public stable as $$
  select g.id, g.ante, g.player_x, p.display_name, g.room_collection, g.created_at
    from public.mp_warfront_games g
    join public.profiles p on p.id = g.player_x
   where g.status = 'waiting'
     and g.player_x <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
   order by g.created_at desc
   limit 20;
$$;

grant execute on function public.wf_pvp_open_rooms() to authenticated;


-- ============================================================================
-- Done.
-- ============================================================================
