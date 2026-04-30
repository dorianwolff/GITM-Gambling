-- ============================================================================
-- Migration v3 — Case opening, Multiplayer games, Peak credits stat
--
-- Run in: Supabase Dashboard → SQL editor → New query → paste & run.
-- Idempotent where possible; re-runnable.
--
-- Adds:
--   * profiles.peak_credits  — all-time maximum balance
--   * profiles.case_pity     — consecutive commons for pity counter
--   * _apply_credit_delta    — now auto-tracks peak_credits
--   * case_openings table    — history / audit log
--   * open_case RPC          — 3 tiers + golden-key modifier + pity boost
--   * mp_games table         — lobby + live state
--   * mp_*  RPCs             — create / join / move / resign / cancel
--   * transactions.kind      — widened to allow new kinds
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Widen transactions.kind to accept the new kinds we emit below.
--    (Drop & recreate the CHECK constraint.)
-- ----------------------------------------------------------------------------
alter table public.transactions drop constraint if exists transactions_kind_check;
alter table public.transactions
  add constraint transactions_kind_check check (kind in (
    'daily_claim','signup_bonus',
    'bet_place','bet_payout',
    'game_coinflip','game_dice','game_roulette','game_blackjack','game_crash',
    'game_case','game_mp','mp_refund',
    'emoji_hunt','admin_grant','admin_revoke'
  ));

-- ----------------------------------------------------------------------------
-- 1. profiles: peak_credits + case_pity columns
-- ----------------------------------------------------------------------------
alter table public.profiles add column if not exists peak_credits integer not null default 0;
alter table public.profiles add column if not exists case_pity    integer not null default 0;

-- Backfill peak from current balance on first run.
update public.profiles set peak_credits = greatest(peak_credits, credits);

-- Tighten the self-update RLS to forbid touching the new protected columns.
drop policy if exists "profiles update self limited" on public.profiles;
create policy "profiles update self limited" on public.profiles
  for update using (auth.uid() = id)
  with check (
    auth.uid() = id
    and credits        = (select credits        from public.profiles where id = auth.uid())
    and is_admin       = (select is_admin       from public.profiles where id = auth.uid())
    and streak_days    = (select streak_days    from public.profiles where id = auth.uid())
    and last_claim_date is not distinct from (select last_claim_date from public.profiles where id = auth.uid())
    and total_wagered  = (select total_wagered  from public.profiles where id = auth.uid())
    and total_won      = (select total_won      from public.profiles where id = auth.uid())
    and peak_credits   = (select peak_credits   from public.profiles where id = auth.uid())
    and case_pity      = (select case_pity      from public.profiles where id = auth.uid())
  );

-- ----------------------------------------------------------------------------
-- 2. _apply_credit_delta: now tracks peak_credits atomically.
-- ----------------------------------------------------------------------------
create or replace function public._apply_credit_delta(
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
     set credits       = credits + p_delta,
         peak_credits  = greatest(peak_credits, credits + p_delta),
         total_wagered = total_wagered + greatest(-p_delta, 0),
         total_won     = total_won     + greatest( p_delta, 0)
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
revoke all on function public._apply_credit_delta(uuid,integer,text,jsonb) from public;

-- Update the leaderboard view so peak_credits ships with it.
create or replace view public.v_leaderboard as
  select id, display_name, avatar_url, credits, peak_credits, total_wagered, total_won
    from public.profiles
   order by credits desc
   limit 100;
grant select on public.v_leaderboard to authenticated, anon;

-- ============================================================================
-- 3. CASE OPENING
-- ============================================================================
-- Design
--   Tiers: bronze (10 cr), silver (50 cr), gold (100 cr).
--   Loot rarities (same weights for all tiers, reward scales with tier):
--     common      55.0%  → 0.0x  (dud)
--     uncommon    28.0%  → 1.0x  (refund)
--     rare        11.0%  → 2.0x
--     epic         4.0%  → 4.0x
--     legendary    1.7%  → 10.0x
--     jackpot      0.3%  → 40.0x
--   Nominal RTP ≈ 95.5%, heavy variance.
--
--   Golden-key modifier (p_key = true):
--     Player pays tier_cost * 1.5. Common tier is replaced by uncommon.
--     Same payout table, so RTP rises to ~118% for the extra 50% cost
--     — meaning keys are a "spend more for better odds" gamble with a
--     slight player edge to make them feel special. Still bounded by
--     the jackpot chance so house variance is healthy.
--
--   Pity counter:
--     profiles.case_pity counts consecutive commons per user.
--     On reaching 10, the next open auto-upgrades from common to rare.
--     Counter resets on any non-common draw.
--
-- Returns: new_balance, tier, rarity, reward, cost, pity (new value).
-- ----------------------------------------------------------------------------

create table if not exists public.case_openings (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  tier        text not null check (tier in ('bronze','silver','gold')),
  cost        integer not null,
  rarity      text not null,
  reward      integer not null,
  key_used    boolean not null default false,
  pity_popped boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists case_openings_user_idx
  on public.case_openings (user_id, created_at desc);

alter table public.case_openings enable row level security;
drop policy if exists "case_openings read own" on public.case_openings;
create policy "case_openings read own" on public.case_openings
  for select using (auth.uid() = user_id);

create or replace function public.open_case(p_tier text, p_key boolean default false)
returns table(
  new_balance integer, tier text, rarity text, reward integer,
  cost integer, pity integer, pity_popped boolean, key_used boolean,
  multiplier numeric
)
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  base_cost integer;
  final_cost integer;
  r numeric;
  rar text;
  mult numeric;
  rew integer;
  cur_pity integer;
  pity_hit boolean := false;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  case p_tier
    when 'bronze' then base_cost := 10;
    when 'silver' then base_cost := 50;
    when 'gold'   then base_cost := 100;
    else raise exception 'Unknown tier %', p_tier;
  end case;

  final_cost := case when p_key then (base_cost * 3) / 2 else base_cost end;

  -- Read pity counter with a lock so pity increments are race-free under
  -- concurrent opens.
  select case_pity into cur_pity from public.profiles where id = uid for update;
  if cur_pity is null then cur_pity := 0; end if;

  -- Charge the wager first.
  perform public._apply_credit_delta(uid, -final_cost, 'game_case',
    jsonb_build_object('phase','wager','tier',p_tier,'key',p_key));

  -- Roll rarity.
  r := random();

  if p_key then
    -- Key removes common; thresholds renormalise over remaining 45%.
    --   uncommon  28/45 = 62.222%
    --   rare      11/45 = 24.444%
    --   epic       4/45 =  8.889%
    --   legendary 1.7/45=  3.778%
    --   jackpot   0.3/45=  0.667%
    if    r < 0.62222 then rar := 'uncommon';
    elsif r < 0.86666 then rar := 'rare';
    elsif r < 0.95555 then rar := 'epic';
    elsif r < 0.99333 then rar := 'legendary';
    else                   rar := 'jackpot';
    end if;
  else
    if    r < 0.55   then rar := 'common';
    elsif r < 0.83   then rar := 'uncommon';
    elsif r < 0.94   then rar := 'rare';
    elsif r < 0.98   then rar := 'epic';
    elsif r < 0.997  then rar := 'legendary';
    else                  rar := 'jackpot';
    end if;

    -- Pity upgrade: if this would be a common AND we're at the threshold,
    -- bump to rare.
    if rar = 'common' and cur_pity >= 9 then
      rar := 'rare';
      pity_hit := true;
    end if;
  end if;

  -- Map rarity → multiplier
  mult := case rar
    when 'common'    then 0.0
    when 'uncommon'  then 1.0
    when 'rare'      then 2.0
    when 'epic'      then 4.0
    when 'legendary' then 10.0
    when 'jackpot'   then 40.0
  end;

  rew := floor(base_cost * mult)::int;

  if rew > 0 then
    perform public._apply_credit_delta(uid, rew, 'game_case',
      jsonb_build_object('phase','reward','tier',p_tier,'rarity',rar,
        'key', p_key, 'pity_hit', pity_hit));
  else
    perform public._apply_credit_delta(uid, 0, 'game_case',
      jsonb_build_object('phase','loss','tier',p_tier,'rarity',rar,
        'key', p_key));
  end if;

  -- Pity bookkeeping.
  if rar = 'common' then
    cur_pity := cur_pity + 1;
  else
    cur_pity := 0;
  end if;
  update public.profiles set case_pity = cur_pity where id = uid;

  insert into public.case_openings (user_id, tier, cost, rarity, reward, key_used, pity_popped)
    values (uid, p_tier, final_cost, rar, rew, p_key, pity_hit);

  return query
    select p.credits, p_tier, rar, rew, final_cost, cur_pity, pity_hit, p_key, mult
      from public.profiles p where p.id = uid;
end; $$;
grant execute on function public.open_case(text, boolean) to authenticated;

-- ============================================================================
-- 4. MULTIPLAYER
-- ============================================================================
-- A single mp_games row holds all state for any variant. Variants are:
--   'ttt_chaos' — 3×3 tic-tac-toe; after every move a random empty cell is
--                 "locked" and can't be used on the very next move. The
--                 previously locked cell unlocks immediately.
--                 state: { board: int[9], locked: int|null }
--   'ttt_fade'  — 3×3 tic-tac-toe; each player only ever has 3 pieces on
--                 the board. Placing a 4th fades the oldest piece of that
--                 player. Standard 3-in-a-row wins.
--                 state: { board: int[9], x_moves: int[], o_moves: int[] }
--
-- Pot: 2*ante total. Winner takes 95% of pot (5% house). Draws refund.
-- Both players must be authenticated and distinct.
-- ----------------------------------------------------------------------------

create table if not exists public.mp_games (
  id          uuid primary key default gen_random_uuid(),
  game_type   text not null check (game_type in ('ttt_chaos','ttt_fade')),
  status      text not null check (status in ('waiting','active','done','cancelled')),
  ante        integer not null check (ante > 0 and ante <= 10000),
  player_x    uuid not null references public.profiles(id) on delete cascade,
  player_o    uuid         references public.profiles(id) on delete set null,
  turn        smallint not null default 0 check (turn in (0,1)),
  state       jsonb    not null,
  winner      smallint check (winner in (-1,0,1)),   -- null ongoing, -1 draw, 0 X, 1 O
  last_move   jsonb,
  created_at  timestamptz not null default now(),
  ended_at    timestamptz
);

create index if not exists mp_games_waiting_idx
  on public.mp_games (created_at desc) where status = 'waiting';
create index if not exists mp_games_active_idx
  on public.mp_games (created_at desc) where status = 'active';
create index if not exists mp_games_players_idx
  on public.mp_games (player_x, player_o);

alter table public.mp_games enable row level security;
-- Anyone signed in can browse the lobby and spectate.
drop policy if exists "mp_games read all" on public.mp_games;
create policy "mp_games read all" on public.mp_games
  for select using (auth.role() = 'authenticated');

do $$
begin
  perform 1 from pg_publication where pubname = 'supabase_realtime';
  if found then
    begin alter publication supabase_realtime add table public.mp_games;
    exception when duplicate_object then null; end;
  end if;
end $$;

-- ---------------- helper: who-am-i-as-seat (0/1) or null if spectator ----------------
create or replace function public._mp_seat(h public.mp_games)
returns smallint language sql immutable as $$
  select case
           when auth.uid() = h.player_x then 0::smallint
           when auth.uid() = h.player_o then 1::smallint
           else null
         end;
$$;

-- ---------------- helper: check win on a 3x3 board ----------------
-- board: int[9] with 0=empty, 1=X, 2=O. returns 0 for X win, 1 for O win, null otherwise.
create or replace function public._mp_ttt_winner(b int[])
returns smallint language plpgsql immutable as $$
declare
  lines int[][] := array[
    array[1,2,3], array[4,5,6], array[7,8,9],   -- rows
    array[1,4,7], array[2,5,8], array[3,6,9],   -- cols
    array[1,5,9], array[3,5,7]                  -- diags
  ];
  i int;
  a int; c1 int;
begin
  if b is null or array_length(b,1) is null then return null; end if;
  for i in 1..8 loop
    a := lines[i][1]; c1 := b[a];
    if c1 <> 0 and b[lines[i][2]] = c1 and b[lines[i][3]] = c1 then
      return (c1 - 1)::smallint;
    end if;
  end loop;
  return null;
end; $$;

-- ---------------- helper: finalize a game and pay out ----------------
create or replace function public._mp_finalize(p_id uuid, p_winner smallint, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  g public.mp_games%rowtype;
  pot integer;
  net integer;
  win_uid uuid;
begin
  select * into g from public.mp_games where id = p_id for update;
  if not found or g.status = 'done' or g.status = 'cancelled' then return; end if;

  pot := g.ante * 2;

  if p_winner = -1 then
    -- Draw: refund both.
    perform public._apply_credit_delta(g.player_x, g.ante, 'mp_refund',
      jsonb_build_object('mp_id', p_id, 'reason','draw'));
    if g.player_o is not null then
      perform public._apply_credit_delta(g.player_o, g.ante, 'mp_refund',
        jsonb_build_object('mp_id', p_id, 'reason','draw'));
    end if;
  elsif p_winner = 0 or p_winner = 1 then
    net := (pot * 95) / 100;  -- 5% house fee
    win_uid := case when p_winner = 0 then g.player_x else g.player_o end;
    if win_uid is not null then
      perform public._apply_credit_delta(win_uid, net, 'game_mp',
        jsonb_build_object('mp_id', p_id, 'pot', pot, 'net', net, 'reason', p_reason));
    end if;
  end if;

  update public.mp_games
     set status  = 'done',
         winner  = p_winner,
         ended_at = now()
   where id = p_id;
end; $$;

-- ---------------- mp_create_game ----------------
create or replace function public.mp_create_game(p_game_type text, p_ante integer)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  new_id uuid;
  init_state jsonb;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_ante < 1 or p_ante > 10000 then raise exception 'Invalid ante'; end if;
  if p_game_type not in ('ttt_chaos','ttt_fade') then raise exception 'Unknown game type'; end if;

  -- Cap concurrent open/waiting games per user to 1 (prevents lobby spam).
  if exists (
    select 1 from public.mp_games
     where player_x = uid and status in ('waiting','active')
  ) then
    raise exception 'You already have an open game. Cancel or finish it first.';
  end if;

  -- Build the initial state for this variant.
  if p_game_type = 'ttt_chaos' then
    init_state := jsonb_build_object(
      'board',  jsonb_build_array(0,0,0,0,0,0,0,0,0),
      'locked', null
    );
  else
    init_state := jsonb_build_object(
      'board',   jsonb_build_array(0,0,0,0,0,0,0,0,0),
      'x_moves', jsonb_build_array(),
      'o_moves', jsonb_build_array()
    );
  end if;

  -- Escrow the ante.
  perform public._apply_credit_delta(uid, -p_ante, 'game_mp',
    jsonb_build_object('phase','ante','game_type',p_game_type));

  insert into public.mp_games (game_type, status, ante, player_x, state)
    values (p_game_type, 'waiting', p_ante, uid, init_state)
    returning id into new_id;
  return new_id;
end; $$;
grant execute on function public.mp_create_game(text,integer) to authenticated;

-- ---------------- mp_join_game ----------------
create or replace function public.mp_join_game(p_id uuid)
returns setof public.mp_games
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  g public.mp_games%rowtype;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into g from public.mp_games where id = p_id for update;
  if not found then raise exception 'Game not found'; end if;
  if g.status <> 'waiting' then raise exception 'Game is not open'; end if;
  if g.player_x = uid then raise exception 'You created this game'; end if;

  perform public._apply_credit_delta(uid, -g.ante, 'game_mp',
    jsonb_build_object('phase','ante','mp_id',p_id));

  update public.mp_games
     set player_o = uid,
         status   = 'active',
         turn     = 0
   where id = p_id;

  return query select * from public.mp_games where id = p_id;
end; $$;
grant execute on function public.mp_join_game(uuid) to authenticated;

-- ---------------- mp_cancel_game (creator only, waiting only) ----------------
create or replace function public.mp_cancel_game(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  g public.mp_games%rowtype;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into g from public.mp_games where id = p_id for update;
  if not found then raise exception 'Game not found'; end if;
  if g.player_x <> uid then raise exception 'Only creator can cancel'; end if;
  if g.status <> 'waiting' then raise exception 'Only waiting games can be cancelled'; end if;

  perform public._apply_credit_delta(uid, g.ante, 'mp_refund',
    jsonb_build_object('mp_id', p_id, 'reason', 'cancelled'));

  update public.mp_games
     set status = 'cancelled', ended_at = now()
   where id = p_id;
end; $$;
grant execute on function public.mp_cancel_game(uuid) to authenticated;

-- ---------------- mp_resign ----------------
create or replace function public.mp_resign(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  g public.mp_games%rowtype;
  seat smallint;
  winner smallint;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into g from public.mp_games where id = p_id for update;
  if not found then raise exception 'Game not found'; end if;
  if g.status <> 'active' then raise exception 'Game not active'; end if;

  seat := case when uid = g.player_x then 0 when uid = g.player_o then 1 else null end;
  if seat is null then raise exception 'Not a player in this game'; end if;

  winner := case when seat = 0 then 1 else 0 end;
  perform public._mp_finalize(p_id, winner, 'resign');
end; $$;
grant execute on function public.mp_resign(uuid) to authenticated;

-- ---------------- mp_make_move ----------------
-- p_move example: { "cell": 4 }   (index 0..8 on the 3x3)
create or replace function public.mp_make_move(p_id uuid, p_move jsonb)
returns setof public.mp_games
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  g public.mp_games%rowtype;
  seat smallint;
  cell int;
  board int[];
  locked int;
  x_moves int[];
  o_moves int[];
  marker int;
  w smallint;
  new_locked int;
  empties int[];
  faded_cell int;
  mover text;
  filled boolean;
  new_state jsonb;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into g from public.mp_games where id = p_id for update;
  if not found then raise exception 'Game not found'; end if;
  if g.status <> 'active' then raise exception 'Game not active'; end if;

  seat := case when uid = g.player_x then 0 when uid = g.player_o then 1 else null end;
  if seat is null then raise exception 'Not a player in this game'; end if;
  if seat <> g.turn then raise exception 'Not your turn'; end if;

  cell := (p_move->>'cell')::int;
  if cell is null or cell < 0 or cell > 8 then raise exception 'Invalid cell'; end if;

  marker := case when seat = 0 then 1 else 2 end;
  mover  := case when seat = 0 then 'x' else 'o' end;

  -- Decode board (jsonb array → int[]).
  board := array(select (jsonb_array_elements_text(g.state->'board'))::int);
  if board[cell + 1] <> 0 then raise exception 'Cell not empty'; end if;

  if g.game_type = 'ttt_chaos' then
    locked := (g.state->>'locked')::int;
    if locked is not null and locked = cell then
      raise exception 'Cell is locked this turn';
    end if;

    board[cell + 1] := marker;

    -- Pick a new locked cell: any empty cell OTHER than the one just played,
    -- excluding the previously-locked cell (which unlocks now).
    select array_agg(i - 1) into empties
      from generate_series(1,9) i
      where board[i] = 0;

    if empties is null or array_length(empties,1) = 0 then
      new_locked := null;
    else
      new_locked := empties[1 + floor(random() * array_length(empties,1))::int];
    end if;

    new_state := jsonb_build_object(
      'board',  to_jsonb(board),
      'locked', to_jsonb(new_locked)
    );

  elsif g.game_type = 'ttt_fade' then
    x_moves := array(select (jsonb_array_elements_text(g.state->'x_moves'))::int);
    o_moves := array(select (jsonb_array_elements_text(g.state->'o_moves'))::int);

    board[cell + 1] := marker;
    if mover = 'x' then
      x_moves := x_moves || cell;
      if array_length(x_moves,1) > 3 then
        faded_cell := x_moves[1];
        x_moves := x_moves[2:];
        -- Only clear if no one else occupies that cell (shouldn't happen; defensive).
        if board[faded_cell + 1] = 1 then board[faded_cell + 1] := 0; end if;
      end if;
    else
      o_moves := o_moves || cell;
      if array_length(o_moves,1) > 3 then
        faded_cell := o_moves[1];
        o_moves := o_moves[2:];
        if board[faded_cell + 1] = 2 then board[faded_cell + 1] := 0; end if;
      end if;
    end if;

    new_state := jsonb_build_object(
      'board',   to_jsonb(board),
      'x_moves', to_jsonb(x_moves),
      'o_moves', to_jsonb(o_moves),
      'faded',   to_jsonb(faded_cell)
    );
  else
    raise exception 'Unknown game type';
  end if;

  -- Evaluate winner.
  w := public._mp_ttt_winner(board);

  update public.mp_games
     set state     = new_state,
         turn      = case when w is null then (1 - g.turn)::smallint else g.turn end,
         last_move = jsonb_build_object('seat', seat, 'cell', cell, 'at', now())
   where id = p_id;

  if w is not null then
    perform public._mp_finalize(p_id, w, 'three-in-a-row');
  else
    -- Draw detection for chaos (board full) and fade (never truly full because
    -- pieces fade; we cap fade games at 20 plies of stalemate by counting
    -- empties after a fade — if <=1 empties for 6 consecutive plies we stop).
    if g.game_type = 'ttt_chaos' then
      filled := not exists (select 1 from generate_series(1,9) i where board[i] = 0);
      if filled then
        perform public._mp_finalize(p_id, -1::smallint, 'board-full');
      end if;
    end if;
  end if;

  return query select * from public.mp_games where id = p_id;
end; $$;
grant execute on function public.mp_make_move(uuid, jsonb) to authenticated;

-- Done.
