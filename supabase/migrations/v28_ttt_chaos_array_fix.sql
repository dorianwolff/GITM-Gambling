-- v28_ttt_chaos_array_fix.sql
-- Fix "malformed array literal: 'block'" on mp_join_game for ttt_chaos rooms.
--
-- Root cause: in _mp_chaos_roll_event (v5), the pattern
--   pool := pool || 'block';
-- uses the || operator with text[] on the left and an untyped string literal
-- on the right.  PostgreSQL resolves the overload to text[] || text[] (array
-- concatenation) and then tries to parse the literal 'block' as an array —
-- giving "malformed array literal: 'block'" at runtime.
--
-- Fix: replace every `pool || 'event_name'` with `array_append(pool, 'event_name')`,
-- which unambiguously appends a single text element.
--
-- Also re-creates the opening-event trigger function for clarity/safety.
-- No schema changes required.

-- ── 1. Fix _mp_chaos_roll_event ───────────────────────────────────────────────

create or replace function public._mp_chaos_roll_event(
  p_board     int[],       -- 9-element int array, 0=empty, 1=X, 2=O
  p_next_seat smallint     -- 0 (X) or 1 (O) — whose turn is starting
) returns jsonb
language plpgsql volatile as $$
declare
  own_marker int     := case when p_next_seat = 0 then 1 else 2 end;
  opp_marker int     := case when p_next_seat = 0 then 2 else 1 end;
  empties    int[]   := '{}';
  own_cells  int[]   := '{}';
  opp_cells  int[]   := '{}';
  pool       text[]  := '{}'::text[];
  pick       text;
  chosen     int;
  chosen2    int;
  board      int[]   := p_board;
begin
  select array_agg(i - 1) into empties
    from generate_series(1,9) i where board[i] = 0;
  select array_agg(i - 1) into own_cells
    from generate_series(1,9) i where board[i] = own_marker;
  select array_agg(i - 1) into opp_cells
    from generate_series(1,9) i where board[i] = opp_marker;

  -- Use array_append to avoid the text[] || unknown → text[] || text[]
  -- operator resolution that mis-parses the literal as an array.

  -- Block: need at least 2 empty cells (can't block if only one left).
  if empties is not null and array_length(empties, 1) >= 2 then
    pool := array_append(pool, 'block');
  end if;
  -- Remove own: need at least one own piece.
  if own_cells is not null and array_length(own_cells, 1) >= 1 then
    pool := array_append(pool, 'remove_own');
  end if;
  -- Remove opp: need at least one opp piece.
  if opp_cells is not null and array_length(opp_cells, 1) >= 1 then
    pool := array_append(pool, 'remove_opp');
  end if;
  -- Swap: need at least one of each.
  if own_cells is not null and opp_cells is not null
     and array_length(own_cells, 1) >= 1 and array_length(opp_cells, 1) >= 1 then
    pool := array_append(pool, 'swap');
  end if;

  if array_length(pool, 1) is null then
    return jsonb_build_object('type', 'nothing', 'board', to_jsonb(board));
  end if;

  pick := pool[1 + (floor(random() * array_length(pool, 1)))::int];

  if pick = 'block' then
    chosen := empties[1 + (floor(random() * array_length(empties, 1)))::int];
    return jsonb_build_object('type', 'block', 'cell', chosen, 'board', to_jsonb(board));

  elsif pick = 'remove_own' then
    chosen := own_cells[1 + (floor(random() * array_length(own_cells, 1)))::int];
    board[chosen + 1] := 0;
    return jsonb_build_object('type', 'remove_own', 'cell', chosen, 'board', to_jsonb(board));

  elsif pick = 'remove_opp' then
    chosen := opp_cells[1 + (floor(random() * array_length(opp_cells, 1)))::int];
    board[chosen + 1] := 0;
    return jsonb_build_object('type', 'remove_opp', 'cell', chosen, 'board', to_jsonb(board));

  else -- swap
    chosen  := own_cells [1 + (floor(random() * array_length(own_cells,  1)))::int];
    chosen2 := opp_cells [1 + (floor(random() * array_length(opp_cells,  1)))::int];
    board[chosen  + 1] := opp_marker;
    board[chosen2 + 1] := own_marker;
    return jsonb_build_object('type', 'swap', 'own', chosen, 'opp', chosen2, 'board', to_jsonb(board));
  end if;
end; $$;


-- ── 2. Re-create the opening-event trigger function ───────────────────────────
-- (unchanged logic, just re-applied to pick up the fixed _mp_chaos_roll_event)

drop trigger if exists mp_chaos_opening_event on public.mp_games;

create or replace function public._mp_chaos_opening_event_trg()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  board int[];
  ev    jsonb;
begin
  if NEW.game_type = 'ttt_chaos'
     and NEW.status = 'active'
     and (OLD.status is null or OLD.status <> 'active') then

    -- Parse the board from its initial JSONB array form.
    board := array(
      select (jsonb_array_elements_text(NEW.state -> 'board'))::int
    );

    -- Roll the opening event (X moves first, seat = 0).
    ev := public._mp_chaos_roll_event(board, 0::smallint);

    -- Adopt the (possibly mutated) board from the event.
    board := array(
      select (jsonb_array_elements_text(ev -> 'board'))::int
    );

    -- Write the enriched state back onto the row before it is persisted.
    NEW.state := jsonb_build_object(
      'board',  to_jsonb(board),
      'locked', case
                  when ev ->> 'type' = 'block' then ev -> 'cell'
                  else 'null'::jsonb
                end,
      'event',  ev - 'board'   -- strip the board copy; keep type + cell/own/opp
    );
  end if;
  return NEW;
end; $$;

create trigger mp_chaos_opening_event
  before update on public.mp_games
  for each row execute function public._mp_chaos_opening_event_trg();
