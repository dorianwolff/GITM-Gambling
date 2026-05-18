-- v30_warfront_pvp.sql
-- Warfront PvP: two players each draft a team from the current rotation,
-- commit picks simultaneously, then the server scores both armies and pays
-- the winner 2× their combined ante.
--
-- Status flow:  waiting → drafting → finished
--   waiting  — creator is in, waiting for an opponent
--   drafting — both players present; each may commit their picks at any time
--   finished — both committed, result computed, payout done; clients animate
--
-- No separate "battle" state: when status flips to 'finished' the client knows
-- to run the animation immediately, then show the result screen.

-- ── 1. Table ──────────────────────────────────────────────────────────────────

create table if not exists public.mp_warfront_games (
  id           uuid primary key default gen_random_uuid(),
  status       text not null default 'waiting'
               check (status in ('waiting','drafting','finished')),
  ante         integer not null check (ante >= 10 and ante <= 10000),
  player_x     uuid not null references public.profiles(id),
  player_o     uuid          references public.profiles(id),
  -- Picks are text[] (unit-ID arrays) committed per player.
  x_picks      text[] default null,
  o_picks      text[] default null,
  x_collection text   not null default 'fantasy',
  o_collection text   not null default 'fantasy',
  x_ready      boolean not null default false,
  o_ready      boolean not null default false,
  -- Result fields (populated when status → 'finished')
  winner       smallint default null check (winner is null or winner in (-1,0,1)),
  result_reason text,
  x_base_hp    integer default null,   -- cosmetic; winner keeps HP, loser = 0
  o_base_hp    integer default null,
  created_at   timestamptz not null default now(),
  ended_at     timestamptz
);

alter table public.mp_warfront_games enable row level security;
drop policy if exists "mp_warfront_games read all" on public.mp_warfront_games;
create policy "mp_warfront_games read all" on public.mp_warfront_games
  for select using (true);

create index if not exists mp_warfront_games_waiting_idx
  on public.mp_warfront_games (created_at desc)
  where status = 'waiting';

create index if not exists mp_warfront_games_players_idx
  on public.mp_warfront_games (player_x, player_o);

-- Realtime (idempotent).
do $$
begin
  alter publication supabase_realtime add table public.mp_warfront_games;
exception when others then null;
end; $$;


-- ── 2. wf_pvp_create ─────────────────────────────────────────────────────────
-- Create a waiting room and deduct the ante from the creator.
-- Returns the new game row.

create or replace function public.wf_pvp_create(p_ante integer)
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

  -- Prevent players from having more than one open room at a time.
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

  insert into public.mp_warfront_games (ante, player_x)
    values (p_ante, uid)
    returning id into game_id;

  return query select * from public.mp_warfront_games where id = game_id;
end; $$;

grant execute on function public.wf_pvp_create(integer) to authenticated;


-- ── 3. wf_pvp_join ───────────────────────────────────────────────────────────
-- Second player joins a waiting room; deducts their ante, opens drafting.

create or replace function public.wf_pvp_join(p_game_id uuid)
returns setof public.mp_warfront_games
language plpgsql security definer set search_path = public as $$
declare
  uid  uuid := auth.uid();
  g    public.mp_warfront_games%rowtype;
  prof public.profiles%rowtype;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not public.is_game_active('warfront') then
    raise exception 'Warfront is not in the current rotation';
  end if;

  select * into g from public.mp_warfront_games where id = p_game_id for update;
  if not found then raise exception 'Room not found'; end if;
  if g.status <> 'waiting' then raise exception 'Room is not open'; end if;
  if g.player_x = uid then raise exception 'You created this room'; end if;

  select * into prof from public.profiles where id = uid for update;
  if prof.credits < g.ante then
    raise exception 'Not enough credits (need %)', g.ante;
  end if;

  perform public._apply_credit_delta(uid, -g.ante, 'game_mp',
    jsonb_build_object('phase','ante','game','warfront_pvp','room_id', p_game_id));

  update public.mp_warfront_games
     set player_o = uid,
         status   = 'drafting'
   where id = p_game_id;

  return query select * from public.mp_warfront_games where id = p_game_id;
end; $$;

grant execute on function public.wf_pvp_join(uuid) to authenticated;


-- ── 4. wf_pvp_commit ─────────────────────────────────────────────────────────
-- A player commits their drafted army.  When the second player commits the
-- server immediately scores both armies, decides the winner, credits the pot,
-- and transitions to 'finished' so both clients can run the battle animation.

create or replace function public.wf_pvp_commit(
  p_game_id    uuid,
  p_picks      text[],
  p_collection text default 'fantasy'
) returns setof public.mp_warfront_games
language plpgsql security definer set search_path = public as $$
declare
  uid         uuid := auth.uid();
  g           public.mp_warfront_games%rowtype;
  v_units     jsonb;
  v_active_pool text[];
  v_id        text;
  v_u         jsonb;
  v_cost      int;
  v_total_cost int := 0;
  v_i         int;
  v_seat      text;   -- 'x' or 'o'
  -- resolution
  v_x_score   numeric;
  v_o_score   numeric;
  v_margin    numeric;
  v_x_win_p   numeric;
  v_winner    smallint;
  v_win_uid   uuid;
  v_pot       integer;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_collection not in ('fantasy','animals') then
    raise exception 'Invalid collection: %', p_collection;
  end if;
  if array_length(p_picks,1) is null or array_length(p_picks,1) < 1
     or array_length(p_picks,1) > 6 then
    raise exception 'Pick between 1 and 6 units';
  end if;

  -- Lock the row for the duration of this transaction to prevent double-settle.
  select * into g from public.mp_warfront_games where id = p_game_id for update;
  if not found then raise exception 'Room not found'; end if;
  if g.status <> 'drafting' then
    raise exception 'Room is not in drafting phase';
  end if;

  -- Determine seat.
  if uid = g.player_x then v_seat := 'x';
  elsif uid = g.player_o then v_seat := 'o';
  else raise exception 'You are not in this room';
  end if;

  -- Idempotent: if already committed, just return current state.
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

  -- Save picks and set ready flag atomically.
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

  -- If both players have now committed, resolve the match.
  if g.x_ready and g.o_ready then
    -- Score both armies using the existing scoring heuristic.
    v_x_score := public._warfront_score(to_jsonb(g.x_picks), g.x_collection, true);
    v_o_score := public._warfront_score(to_jsonb(g.o_picks), g.o_collection, true);

    -- Win-probability for X: 50% base ±35% based on score margin.
    -- Clamped to [0.15, 0.85] so there is always a chance for an upset.
    v_margin   := (v_x_score - v_o_score) / greatest(v_x_score + v_o_score + 100, 1);
    v_x_win_p  := greatest(0.15, least(0.85, 0.5 + v_margin * 0.35));

    if random() < v_x_win_p then
      v_winner := 0;   -- X wins
    else
      v_winner := 1;   -- O wins
    end if;

    -- Pay the winner the full pot (2× ante).
    v_pot     := g.ante * 2;
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

    -- Settle the game row.
    update public.mp_warfront_games
       set status   = 'finished',
           winner   = v_winner,
           result_reason = 'score',
           -- Cosmetic HP: winner keeps a random non-zero HP, loser = 0.
           x_base_hp = case when v_winner = 0 then 10 + floor(random()*80)::int else 0 end,
           o_base_hp = case when v_winner = 1 then 10 + floor(random()*80)::int else 0 end,
           ended_at  = now()
     where id = p_game_id;
  end if;

  return query select * from public.mp_warfront_games where id = p_game_id;
end; $$;

grant execute on function public.wf_pvp_commit(uuid, text[], text) to authenticated;


-- ── 5. wf_pvp_cancel ─────────────────────────────────────────────────────────
-- Creator cancels a waiting room (before anyone joins) and is refunded.

create or replace function public.wf_pvp_cancel(p_game_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  g   public.mp_warfront_games%rowtype;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  select * into g from public.mp_warfront_games
    where id = p_game_id and player_x = uid for update;
  if not found then raise exception 'Room not found or not yours'; end if;
  if g.status <> 'waiting' then raise exception 'Can only cancel a waiting room'; end if;

  -- Refund the creator.
  perform public._apply_credit_delta(uid, g.ante, 'mp_refund',
    jsonb_build_object('game','warfront_pvp','room_id',p_game_id,'reason','cancelled'));

  delete from public.mp_warfront_games where id = p_game_id;
end; $$;

grant execute on function public.wf_pvp_cancel(uuid) to authenticated;


-- ── 6. wf_pvp_open_rooms ─────────────────────────────────────────────────────
-- Returns waiting rooms for the lobby browser (excludes own rooms).

create or replace function public.wf_pvp_open_rooms()
returns table (
  id         uuid,
  ante       integer,
  player_x   uuid,
  x_name     text,
  created_at timestamptz
)
language sql security definer set search_path = public stable as $$
  select g.id, g.ante, g.player_x, p.display_name, g.created_at
    from public.mp_warfront_games g
    join public.profiles p on p.id = g.player_x
   where g.status = 'waiting'
     and g.player_x <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
   order by g.created_at desc
   limit 20;
$$;

grant execute on function public.wf_pvp_open_rooms() to authenticated;
