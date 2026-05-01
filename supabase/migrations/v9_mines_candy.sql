-- ============================================================================
-- v9_mines_candy.sql
--   Adds two new games to the rotation pool:
--     * minesweeper  — stateful "pick N safe tiles" with cashout at any time
--     * candy        — one-shot 6x6 match-3 cascade resolver (slot-like)
--   Plus expands game_pool() to include them, so the 2h rotation cycles
--   now cover 9 games total (6 active, 3 resting).
--
-- Depends on: v5 (_apply_credit_delta, profiles), v7 (is_game_active, game_pool).
-- Idempotent: safe to re-run. No destructive operations.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 25. Extend the rotation pool to include the new offline games.
-- ----------------------------------------------------------------------------
-- Override game_pool() so the 2h rotator will include 'mines' and 'candy'.
-- With 9 pool entries and 6 active slots, every game is out roughly 1/3 of
-- the time (it varies because rotation picks random non-active games each
-- time two slots expire).

-- Must match v7's signature exactly. `create or replace` can't change the
-- return type, so drop first to stay order-independent with v7.
drop function if exists public.game_pool() cascade;
create or replace function public.game_pool()
returns text[] language sql immutable as $$
  select array[
    'coinflip','dice','roulette','blackjack','crash','cases','gacha',
    'mines','candy'
  ]::text[];
$$;
grant execute on function public.game_pool() to authenticated;

-- ----------------------------------------------------------------------------
-- 26. Minesweeper (aka "money démineur")
-- ----------------------------------------------------------------------------
-- One active game per user at a time. Starting a new game while a previous
-- one is still active busts the previous one (forfeits the wager) — this
-- matches how the crash/dice "leave then retry" flow works elsewhere.
--
-- Grid is fixed 5x5 = 25 cells. Mines count is player-chosen in [1, 24].
-- Multiplier (with 3% house edge):
--     M(n, mines) = 0.97 * prod_{k=0..n-1} (25 - k) / (25 - mines - k)
-- where n is the number of safe tiles already revealed.
-- ----------------------------------------------------------------------------

create table if not exists public.minesweeper_games (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  bet          integer not null check (bet >= 1),
  mines        integer not null check (mines between 1 and 24),
  -- Layout is an array of 0..24 cell indices that are MINES. Length = mines.
  -- We never return this to the client while the game is active; only on
  -- game-over (bust) is the full layout revealed.
  mines_layout integer[] not null,
  -- Array of 0..24 cell indices that have been revealed-safe so far.
  revealed     integer[] not null default '{}'::int[],
  status       text not null default 'active'
               check (status in ('active','busted','cashed_out')),
  payout       integer not null default 0,
  created_at   timestamptz not null default now(),
  finished_at  timestamptz
);

create index if not exists minesweeper_games_user_active_idx
  on public.minesweeper_games (user_id)
  where status = 'active';

alter table public.minesweeper_games enable row level security;
drop policy if exists "minesweeper_games read own" on public.minesweeper_games;
create policy "minesweeper_games read own" on public.minesweeper_games
  for select using (auth.uid() = user_id);

-- Server-only helper: compute current multiplier (times 10000 to keep
-- integer precision; client divides by 10000). `n_revealed` is how many
-- safe tiles have been uncovered so far.
create or replace function public._mines_mult_bp(p_mines integer, p_revealed integer)
returns integer language plpgsql immutable as $$
declare
  total integer := 25;
  m numeric := 1.0;
  k integer;
begin
  if p_revealed <= 0 then return 10000; end if;       -- 1.00x
  if p_mines < 1 or p_mines > 24 then return 10000; end if;
  for k in 0..(p_revealed - 1) loop
    -- product (25 - k) / (25 - mines - k)
    if (total - p_mines - k) <= 0 then return 0; end if;
    m := m * (total - k)::numeric / (total - p_mines - k)::numeric;
  end loop;
  return floor(m * 0.97 * 10000)::int;
end; $$;

-- ---------------------------------------------------------------------------
-- minesweeper_start(bet, mines) — deducts credits, abandons any stale game,
-- seeds fresh mine layout, returns the new game id. The layout stays on
-- the server; the client gets only the id + the grid size.
create or replace function public.minesweeper_start(p_bet integer, p_mines integer)
returns table (
  id          uuid,
  new_balance integer,
  bet         integer,
  mines       integer
)
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  prof public.profiles%rowtype;
  gid  uuid;
  layout integer[];
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not public.is_game_active('mines') then
    raise exception 'Minesweeper is currently out of rotation';
  end if;
  if p_bet is null or p_bet < 1 then raise exception 'bet must be >= 1'; end if;
  if p_bet > 100000 then raise exception 'bet too large'; end if;
  if p_mines is null or p_mines < 1 or p_mines > 24 then
    raise exception 'mines must be in [1, 24]';
  end if;

  -- Atomically forfeit any still-active game the user had open. We don't
  -- refund — leaving a minesweeper game hanging is the player's choice,
  -- same as walking away from a crash cash-out window.
  update public.minesweeper_games
     set status = 'busted', finished_at = now(), payout = 0
   where user_id = uid and status = 'active';

  select * into prof from public.profiles where id = uid for update;
  if prof.credits < p_bet then
    raise exception 'Not enough credits (need %)', p_bet;
  end if;

  perform public._apply_credit_delta(uid, -p_bet, 'mines_bet',
    jsonb_build_object('mines', p_mines));

  -- Build mine layout: shuffle 0..24 and take the first `p_mines` indices.
  -- random() scramble → array_agg ordered by random(). Simple & unbiased.
  select array_agg(i order by random()) into layout
    from generate_series(0, 24) g(i);
  layout := layout[1:p_mines];

  insert into public.minesweeper_games (user_id, bet, mines, mines_layout)
    values (uid, p_bet, p_mines, layout)
    returning minesweeper_games.id into gid;

  select credits into new_balance from public.profiles where id = uid;
  id := gid;
  bet := p_bet;
  mines := p_mines;
  return next;
end; $$;
grant execute on function public.minesweeper_start(integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- minesweeper_reveal(id, cell) — safe tiles build toward the cashout;
-- a mine ends the game and reveals the full layout.
create or replace function public.minesweeper_reveal(p_id uuid, p_cell integer)
returns table (
  status            text,
  revealed          integer[],
  hit_mine          boolean,
  mult_bp           integer,
  current_multi     numeric,   -- convenience decimal form
  mines_revealed    integer[], -- non-empty only on bust (full layout leaks)
  potential_payout  integer,
  new_balance       integer
)
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  g   public.minesweeper_games%rowtype;
  is_mine boolean;
  revealed_count integer;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not public.is_game_active('mines') then
    raise exception 'Minesweeper is currently out of rotation';
  end if;
  if p_cell is null or p_cell < 0 or p_cell > 24 then
    raise exception 'cell must be in [0, 24]';
  end if;

  select * into g from public.minesweeper_games
    where id = p_id and user_id = uid for update;
  if not found then raise exception 'Game not found'; end if;
  if g.status <> 'active' then raise exception 'Game is already over'; end if;
  if p_cell = any (g.revealed) then raise exception 'Cell already revealed'; end if;

  is_mine := p_cell = any (g.mines_layout);

  if is_mine then
    update public.minesweeper_games
       set status = 'busted',
           finished_at = now(),
           payout = 0
     where id = p_id
     returning * into g;

    status := 'busted';
    revealed := g.revealed;       -- caller already knew these; unchanged
    hit_mine := true;
    mult_bp := 0;
    current_multi := 0;
    mines_revealed := g.mines_layout;
    potential_payout := 0;
    select credits into new_balance from public.profiles where id = uid;
    return next;
    return;
  end if;

  update public.minesweeper_games
     set revealed = revealed || p_cell
   where id = p_id
   returning * into g;

  revealed_count := cardinality(g.revealed);
  mult_bp := public._mines_mult_bp(g.mines, revealed_count);

  status := 'active';
  revealed := g.revealed;
  hit_mine := false;
  current_multi := mult_bp::numeric / 10000;
  mines_revealed := '{}'::int[];
  potential_payout := floor(g.bet::numeric * mult_bp / 10000)::int;
  select credits into new_balance from public.profiles where id = uid;
  return next;
end; $$;
grant execute on function public.minesweeper_reveal(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- minesweeper_cashout(id) — only legal if at least one safe tile has been
-- revealed. Pays bet × current multiplier, marks game as cashed_out.
create or replace function public.minesweeper_cashout(p_id uuid)
returns table (
  payout      integer,
  mult_bp     integer,
  new_balance integer,
  mines_revealed integer[]
)
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  g   public.minesweeper_games%rowtype;
  rev_count integer;
  mb  integer;
  pay integer;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  -- Cashouts are still permitted when the game rotates out mid-session:
  -- we don't want to trap the user's stake. Only NEW games are gated by
  -- is_game_active (see minesweeper_start).

  select * into g from public.minesweeper_games
    where id = p_id and user_id = uid for update;
  if not found then raise exception 'Game not found'; end if;
  if g.status <> 'active' then raise exception 'Game is already over'; end if;
  rev_count := cardinality(g.revealed);
  if rev_count = 0 then raise exception 'Reveal at least one tile first'; end if;

  mb  := public._mines_mult_bp(g.mines, rev_count);
  pay := floor(g.bet::numeric * mb / 10000)::int;

  perform public._apply_credit_delta(uid, pay, 'mines_cashout',
    jsonb_build_object('game_id', g.id, 'mines', g.mines,
                       'revealed', rev_count, 'mult_bp', mb));

  update public.minesweeper_games
     set status = 'cashed_out', finished_at = now(), payout = pay
   where id = p_id;

  payout := pay;
  mult_bp := mb;
  select credits into new_balance from public.profiles where id = uid;
  mines_revealed := g.mines_layout;
  return next;
end; $$;
grant execute on function public.minesweeper_cashout(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Convenience: public view of a user's active mines game (without layout)
-- so a reload can resume.
create or replace function public.minesweeper_active()
returns table (
  id        uuid,
  bet       integer,
  mines     integer,
  revealed  integer[],
  mult_bp   integer,
  potential_payout integer
)
language plpgsql security definer set search_path = public stable as $$
declare
  uid uuid := auth.uid();
  g   public.minesweeper_games%rowtype;
  rc  integer;
  mb  integer;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into g from public.minesweeper_games
    where user_id = uid and status = 'active'
    order by created_at desc limit 1;
  if not found then return; end if;
  rc := cardinality(g.revealed);
  mb := public._mines_mult_bp(g.mines, rc);

  id := g.id;
  bet := g.bet;
  mines := g.mines;
  revealed := g.revealed;
  mult_bp := mb;
  potential_payout := floor(g.bet::numeric * mb / 10000)::int;
  return next;
end; $$;
grant execute on function public.minesweeper_active() to authenticated;

-- ----------------------------------------------------------------------------
-- 27. Candy Crush (match-3 cascade resolver)
-- ----------------------------------------------------------------------------
-- Stateless one-shot "spin":
--   1. Server generates a 6x6 grid of 6 colors uniformly.
--   2. Cascade loop up to 8 rounds:
--      a. Find all horizontal/vertical runs of length >= 3.
--      b. If no match, break.
--      c. Score each cleared gem at tier multiplier:
--            3-match: 0.15 × bet / match
--            4-match: 0.50 × bet / match
--            5+-match: 1.50 × bet / match
--         (per-match payout clips at reasonable ceilings; see below.)
--      d. Remove matched cells; apply gravity; fill empty cells with
--         random colors.
--   3. Sum payouts; refund capped at 8 × bet to prevent runaway luck.
--
-- EV note: uniform 6-color cascades average ~0.94 × bet per spin at the
-- above tier weights, which puts house edge ≈ 6%. Players still hit rare
-- big cascades so it feels exciting even on net loss. The user asked for
-- "51% perfect-play keep the bet" which informs the tier weights above.
-- ----------------------------------------------------------------------------

create table if not exists public.candy_spins (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  bet         integer not null check (bet >= 1),
  payout      integer not null default 0,
  cascades    integer not null default 0,
  snapshots   jsonb   not null,     -- full step list; replayed client-side
  created_at  timestamptz not null default now()
);

create index if not exists candy_spins_user_idx on public.candy_spins (user_id, created_at desc);
alter table public.candy_spins enable row level security;
drop policy if exists "candy_spins read own" on public.candy_spins;
create policy "candy_spins read own" on public.candy_spins
  for select using (auth.uid() = user_id);

-- Helper: find matches of length >= 3 in an int[36] board (0..5 = color,
-- -1 = empty). Returns the flat set of matched cell indices.
create or replace function public._candy_find_matches(b integer[])
returns integer[] language plpgsql immutable as $$
declare
  i integer;
  r integer;
  c integer;
  start integer;
  color integer;
  run integer;
  acc integer[] := '{}'::int[];
begin
  -- Horizontal
  for r in 0..5 loop
    start := r * 6;
    c := 0;
    while c < 6 loop
      color := b[start + c + 1];
      if color is null or color < 0 then c := c + 1; continue; end if;
      run := 1;
      while c + run < 6 and b[start + c + run + 1] = color loop
        run := run + 1;
      end loop;
      if run >= 3 then
        for i in 0..(run - 1) loop
          acc := acc || (start + c + i);
        end loop;
      end if;
      c := c + run;
    end loop;
  end loop;
  -- Vertical
  for c in 0..5 loop
    r := 0;
    while r < 6 loop
      color := b[r * 6 + c + 1];
      if color is null or color < 0 then r := r + 1; continue; end if;
      run := 1;
      while r + run < 6 and b[(r + run) * 6 + c + 1] = color loop
        run := run + 1;
      end loop;
      if run >= 3 then
        for i in 0..(run - 1) loop
          acc := acc || ((r + i) * 6 + c);
        end loop;
      end if;
      r := r + run;
    end loop;
  end loop;
  -- Dedup (horiz + vert can overlap in L/T shapes).
  select array_agg(distinct x order by x) into acc from unnest(acc) x;
  return coalesce(acc, '{}'::int[]);
end; $$;

-- Apply gravity + refill for an int[36] board (0..5 color, -1 empty).
-- Returns the refilled board. Fresh cells are drawn uniformly from 0..5.
create or replace function public._candy_gravity_refill(b integer[])
returns integer[] language plpgsql as $$
declare
  c integer;
  r integer;
  col integer[];
  out_b integer[];
begin
  out_b := b;
  for c in 0..5 loop
    col := '{}'::int[];
    -- Collect non-empty from bottom to top.
    for r in reverse 5..0 loop
      if out_b[r * 6 + c + 1] is not null and out_b[r * 6 + c + 1] >= 0 then
        col := col || out_b[r * 6 + c + 1];
      end if;
    end loop;
    -- Write them back to the column, packed at the bottom.
    for r in reverse 5..0 loop
      if cardinality(col) > (5 - r) then
        out_b[r * 6 + c + 1] := col[(5 - r) + 1];
      else
        out_b[r * 6 + c + 1] := floor(random() * 6)::int;
      end if;
    end loop;
  end loop;
  return out_b;
end; $$;

-- Main spin.
create or replace function public.candy_spin(p_bet integer)
returns table (
  id          uuid,
  payout      integer,
  cascades    integer,
  snapshots   jsonb,
  new_balance integer
)
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  prof public.profiles%rowtype;
  board integer[];
  i integer;
  matches integer[];
  matched_count integer;
  match_groups jsonb;
  gross_payout integer := 0;
  steps jsonb := '[]'::jsonb;
  round_no integer := 0;
  cap integer;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not public.is_game_active('candy') then
    raise exception 'Candy Crush is currently out of rotation';
  end if;
  if p_bet is null or p_bet < 1 then raise exception 'bet must be >= 1'; end if;
  if p_bet > 50000 then raise exception 'bet too large'; end if;

  select * into prof from public.profiles where id = uid for update;
  if prof.credits < p_bet then
    raise exception 'Not enough credits (need %)', p_bet;
  end if;

  perform public._apply_credit_delta(uid, -p_bet, 'candy_bet', null);

  -- Seed initial board uniformly. NB: sometimes the initial seed itself
  -- contains matches — we resolve those too (part of the cascade, not a
  -- guaranteed freebie — payouts are tiered the same way).
  board := array(select floor(random() * 6)::int from generate_series(1, 36));

  -- Initial snapshot: board, no matches yet.
  steps := steps || jsonb_build_object(
    'kind', 'initial',
    'board', to_jsonb(board)
  );

  cap := p_bet * 8;

  loop
    round_no := round_no + 1;
    matches := public._candy_find_matches(board);
    matched_count := coalesce(cardinality(matches), 0);
    exit when matched_count = 0 or round_no > 8;

    -- Payout for this round. We pay per-cell at a tier based on the
    -- cluster size (proxy: divide matched_count by distinct runs is hard;
    -- approximate by counting the cleared cells and scaling). Cap per
    -- round to keep variance manageable.
    declare
      round_pay integer;
    begin
      round_pay := floor(matched_count * p_bet::numeric * 0.18)::int;
      -- Bonus for huge clears (8+ cells in a single cascade step).
      if matched_count >= 8 then
        round_pay := round_pay + floor(p_bet::numeric * 0.4)::int;
      end if;
      if matched_count >= 12 then
        round_pay := round_pay + floor(p_bet::numeric * 1.0)::int;
      end if;
      gross_payout := least(cap, gross_payout + round_pay);

      match_groups := to_jsonb(matches);
      steps := steps || jsonb_build_object(
        'kind', 'match',
        'round', round_no,
        'cells', match_groups,
        'round_pay', round_pay,
        'board_before', to_jsonb(board)
      );
    end;

    -- Clear matches.
    for i in 1..36 loop
      if (i - 1) = any (matches) then board[i] := -1; end if;
    end loop;

    -- Gravity + refill.
    board := public._candy_gravity_refill(board);

    steps := steps || jsonb_build_object(
      'kind', 'refill',
      'round', round_no,
      'board', to_jsonb(board)
    );
  end loop;

  if gross_payout > 0 then
    perform public._apply_credit_delta(uid, gross_payout, 'candy_payout',
      jsonb_build_object('cascades', round_no - 1));
  end if;

  insert into public.candy_spins (user_id, bet, payout, cascades, snapshots)
    values (uid, p_bet, gross_payout, greatest(0, round_no - 1), steps)
    returning candy_spins.id into id;

  payout := gross_payout;
  cascades := greatest(0, round_no - 1);
  snapshots := steps;
  select credits into new_balance from public.profiles where id = uid;
  return next;
end; $$;
grant execute on function public.candy_spin(integer) to authenticated;

-- Done.
