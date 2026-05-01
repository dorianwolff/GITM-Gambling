-- ============================================================================
-- v15_fix_v12_recursion.sql
--   Fixes a non-idempotency bug in v12: the wrapper/inner rename-dance,
--   when re-run, renamed the wrapper into the inner slot and created a
--   second wrapper that recursively calls itself. Result: every
--   minesweeper / candy / gacha RPC hits
--      ERROR 54001: stack depth limit exceeded
--
-- Recovery strategy (simple, idempotent, no renames):
--   1. DROP the wrappers AND their `_inner` variants, for every affected
--      function. Both may exist in various states; both go.
--   2. CREATE each function fresh under its public name with the full
--      original body from v8/v9 PLUS a one-line
--         perform public._txn_user_lock('<scope>');
--      at the top, so we still get the spam-click protection v12 wanted
--      without any rename trickery.
--
-- open_case / open_case_batch (also touched by v12) are unaffected —
-- v12 used plain DROP + CREATE for those, not the rename dance.
--
-- Depends on: v9, v12 (for _txn_user_lock). Fully idempotent: safe to
-- re-run any number of times.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Purge broken state. `drop function if exists` is idempotent and
--    tolerates missing symbols.
-- ---------------------------------------------------------------------------
drop function if exists public.gacha_pull(integer);
drop function if exists public._gacha_pull_inner(integer);

drop function if exists public.minesweeper_start(integer, integer);
drop function if exists public._minesweeper_start_inner(integer, integer);

drop function if exists public.minesweeper_reveal(uuid, integer);
drop function if exists public._minesweeper_reveal_inner(uuid, integer);

drop function if exists public.minesweeper_cashout(uuid);
drop function if exists public._minesweeper_cashout_inner(uuid);

drop function if exists public.candy_spin(integer);
drop function if exists public._candy_spin_inner(integer);


-- ---------------------------------------------------------------------------
-- 2. gacha_pull — v8 body, lock inlined. Signature matches gacha-api.js:
--    (pull_index, item_id, item_slug, item_name, item_emoji, rarity,
--     is_unique, pity_popped, new_balance, new_pity).
-- ---------------------------------------------------------------------------
create or replace function public.gacha_pull(p_count integer)
returns table (
  pull_index    integer,
  item_id       uuid,
  item_slug     text,
  item_name     text,
  item_emoji    text,
  rarity        text,
  is_unique     boolean,
  pity_popped   boolean,
  new_balance   integer,
  new_pity      integer
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  uid           uuid := auth.uid();
  cost_total    integer;
  per_pull      integer := 100;
  prof          public.profiles%rowtype;
  i             integer;
  picked        public.gacha_pool%rowtype;
  total_w       integer;
  pick_w        integer;
  cum_w         integer;
  cur_pity      integer;
  forced_pity   boolean;
  pulls_made    jsonb := '[]'::jsonb;
  r             record;
  it            public.market_items%rowtype;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  -- Spam-click guard: fail the second concurrent call fast instead of
  -- racing the credit delta + pool updates.
  perform public._txn_user_lock('gacha_pull');

  if p_count is null or p_count not in (1, 10) then
    raise exception 'pull count must be 1 or 10';
  end if;

  if not public.is_game_active('gacha') then
    raise exception 'Gacha is currently out of rotation';
  end if;

  cost_total := case when p_count = 1 then per_pull else 900 end;

  select * into prof from public.profiles where id = uid for update;
  if prof.credits < cost_total then
    raise exception 'Not enough credits (need %)', cost_total;
  end if;

  perform public._apply_credit_delta(uid, -cost_total, 'gacha_pull',
    jsonb_build_object('count', p_count));

  cur_pity := coalesce(prof.gacha_pity, 0);

  for i in 1..p_count loop
    cur_pity := cur_pity + 1;
    forced_pity := (cur_pity >= 80);

    if forced_pity then
      select coalesce(sum(weight), 0) into total_w
        from public.gacha_pool
       where claimed_by is null
         and rarity in ('legendary','mythic','one_of_one');
    else
      select coalesce(sum(weight), 0) into total_w
        from public.gacha_pool
       where claimed_by is null;
    end if;

    if total_w <= 0 then
      perform public._apply_credit_delta(uid, per_pull, 'gacha_pull',
        jsonb_build_object('reason','empty_pool_refund'));
      exit;
    end if;

    pick_w := 1 + floor(random() * total_w)::int;
    cum_w  := 0;

    if forced_pity then
      for r in
        select * from public.gacha_pool
         where claimed_by is null
           and rarity in ('legendary','mythic','one_of_one')
         order by id
         for update
      loop
        cum_w := cum_w + r.weight;
        if cum_w >= pick_w then picked := r; exit; end if;
      end loop;
    else
      for r in
        select * from public.gacha_pool
         where claimed_by is null
         order by id
         for update
      loop
        cum_w := cum_w + r.weight;
        if cum_w >= pick_w then picked := r; exit; end if;
      end loop;
    end if;

    if picked.is_unique then
      update public.gacha_pool
         set claimed_by = uid, claimed_at = now()
       where id = picked.id;
    end if;

    insert into public.user_items (user_id, item_id, qty)
      values (uid, picked.item_id, 1)
      on conflict (user_id, item_id) do update
        set qty = user_items.qty + 1;

    insert into public.gacha_pulls
      (user_id, pool_id, item_id, rarity, cost, pity_popped)
    values
      (uid, picked.id, picked.item_id, picked.rarity,
       per_pull, forced_pity);

    if picked.rarity in ('legendary','mythic','one_of_one') then
      cur_pity := 0;
    end if;

    select * into it from public.market_items where id = picked.item_id;
    pulls_made := pulls_made || jsonb_build_object(
      'pull_index', i,
      'item_id',    it.id,
      'item_slug',  it.slug,
      'item_name',  it.name,
      'item_emoji', coalesce(it.metadata->>'emoji', '🎁'),
      'rarity',     picked.rarity,
      'is_unique',  picked.is_unique,
      'pity_popped', forced_pity
    );
  end loop;

  update public.profiles set gacha_pity = cur_pity where id = uid;

  for r in select * from jsonb_array_elements(pulls_made) as e(p) loop
    pull_index   := (r.p->>'pull_index')::int;
    item_id      := (r.p->>'item_id')::uuid;
    item_slug    := r.p->>'item_slug';
    item_name    := r.p->>'item_name';
    item_emoji   := r.p->>'item_emoji';
    rarity       := r.p->>'rarity';
    is_unique    := (r.p->>'is_unique')::boolean;
    pity_popped  := (r.p->>'pity_popped')::boolean;
    select credits into new_balance from public.profiles where id = uid;
    new_pity     := cur_pity;
    return next;
  end loop;
end; $$;
grant execute on function public.gacha_pull(integer) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. minesweeper_start — v9 body, lock inlined.
-- ---------------------------------------------------------------------------
create or replace function public.minesweeper_start(p_bet integer, p_mines integer)
returns table (
  id          uuid,
  new_balance integer,
  bet         integer,
  mines       integer
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
  prof public.profiles%rowtype;
  gid  uuid;
  layout integer[];
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  perform public._txn_user_lock('mines_start');

  if not public.is_game_active('mines') then
    raise exception 'Minesweeper is currently out of rotation';
  end if;
  if p_bet is null or p_bet < 1 then raise exception 'bet must be >= 1'; end if;
  if p_bet > 100000 then raise exception 'bet too large'; end if;
  if p_mines is null or p_mines < 1 or p_mines > 24 then
    raise exception 'mines must be in [1, 24]';
  end if;

  update public.minesweeper_games
     set status = 'busted', finished_at = now(), payout = 0
   where user_id = uid and status = 'active';

  select * into prof from public.profiles where id = uid for update;
  if prof.credits < p_bet then
    raise exception 'Not enough credits (need %)', p_bet;
  end if;

  perform public._apply_credit_delta(uid, -p_bet, 'mines_bet',
    jsonb_build_object('mines', p_mines));

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
-- 4. minesweeper_reveal — v9 body, lock inlined.
-- ---------------------------------------------------------------------------
create or replace function public.minesweeper_reveal(p_id uuid, p_cell integer)
returns table (
  status            text,
  revealed          integer[],
  hit_mine          boolean,
  mult_bp           integer,
  current_multi     numeric,
  mines_revealed    integer[],
  potential_payout  integer,
  new_balance       integer
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
  g   public.minesweeper_games%rowtype;
  is_mine boolean;
  revealed_count integer;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  perform public._txn_user_lock('mines_reveal');

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
    revealed := g.revealed;
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
-- 5. minesweeper_cashout — v9 body, lock inlined.
-- ---------------------------------------------------------------------------
create or replace function public.minesweeper_cashout(p_id uuid)
returns table (
  payout         integer,
  mult_bp        integer,
  new_balance    integer,
  mines_revealed integer[]
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
  g   public.minesweeper_games%rowtype;
  rev_count integer;
  mb  integer;
  pay integer;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  perform public._txn_user_lock('mines_cashout');

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
-- 6. candy_spin — v9 body, lock inlined.
-- ---------------------------------------------------------------------------
create or replace function public.candy_spin(p_bet integer)
returns table (
  id          uuid,
  payout      integer,
  cascades    integer,
  snapshots   jsonb,
  new_balance integer
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
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
  perform public._txn_user_lock('candy_spin');

  if not public.is_game_active('candy') then
    raise exception 'Candy Crush is currently out of rotation';
  end if;
  if p_bet is null or p_bet < 1 then raise exception 'bet must be >= 1'; end if;
  if p_bet > 50000 then raise exception 'bet too large'; end if;

  select * into prof from public.profiles where id = uid for update;
  if prof.credits < p_bet then
    raise exception 'Not enough credits (need %)', p_bet;
  end if;

  -- NB: `meta` column is NOT NULL on `transactions`. Passing NULL here
  -- bypasses the column default and 500s on the insert, so always hand
  -- the helper an explicit empty object when there's nothing to record.
  perform public._apply_credit_delta(uid, -p_bet, 'candy_bet', '{}'::jsonb);

  board := array(select floor(random() * 6)::int from generate_series(1, 36));

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

    declare
      round_pay integer;
    begin
      round_pay := floor(matched_count * p_bet::numeric * 0.18)::int;
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

    for i in 1..36 loop
      if (i - 1) = any (matches) then board[i] := -1; end if;
    end loop;

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
