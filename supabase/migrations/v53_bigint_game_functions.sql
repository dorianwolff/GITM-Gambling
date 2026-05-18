-- ============================================================================
-- v53_bigint_game_functions.sql
--
-- Widens every game function that reads/writes credits from integer → bigint.
-- v47 already widened profiles.credits and transactions.{delta,balance_after},
-- and v50 fixed admin_grant_credits.  All downstream game RPCs were missed.
--
-- What this migration does:
--   1. ALTER TABLE — widen bet/cost/reward/payout columns in history tables
--   2. DROP old integer-param function signatures
--   3. Recreate every affected RPC with bigint params, variables, and return cols
-- ============================================================================


-- ============================================================================
-- 1. Table column widening
-- ============================================================================

alter table public.case_openings
  alter column cost   type bigint using cost::bigint,
  alter column reward type bigint using reward::bigint;

alter table public.blackjack_hands
  alter column bet           type bigint using bet::bigint,
  alter column insurance_bet type bigint using insurance_bet::bigint;

alter table public.warfront_games
  alter column bet    type bigint using bet::bigint,
  alter column payout type bigint using payout::bigint;

alter table public.minesweeper_games
  alter column bet    type bigint using bet::bigint,
  alter column payout type bigint using payout::bigint;

alter table public.candy_spins
  alter column bet    type bigint using bet::bigint,
  alter column payout type bigint using payout::bigint;

alter table public.plinko_drops
  alter column bet    type bigint using bet::bigint,
  alter column payout type bigint using payout::bigint;

alter table public.lottery_draws
  alter column bet    type bigint using bet::bigint,
  alter column payout type bigint using payout::bigint;


-- ============================================================================
-- 2. Drop all affected function signatures
--    (a) Functions whose parameter types change: must drop to change signature.
--    (b) Functions whose return types change even with the same parameters:
--        PostgreSQL rejects CREATE OR REPLACE when OUT column types differ.
-- ============================================================================

-- (a) parameter type changes
drop function if exists public.play_coinflip(integer, text);
drop function if exists public.play_dice(integer, integer, boolean);
drop function if exists public.play_blackjack(integer, integer);
drop function if exists public.play_crash(integer, numeric);
drop function if exists public.bj_start(integer);
drop function if exists public.play_plinko(integer, integer, text);
drop function if exists public.minesweeper_start(integer, integer);
drop function if exists public.candy_spin(integer);
drop function if exists public.play_lottery(integer, integer[]);
drop function if exists public.play_warfront(integer, text[], text, integer);

-- (b) same parameters, changed return column types
drop function if exists public.play_roulette(jsonb);
drop function if exists public.gacha_pull(integer);
drop function if exists public.minesweeper_reveal(uuid, integer);
drop function if exists public.minesweeper_cashout(uuid);
drop function if exists public.resolve_warfront(uuid, integer, integer);
drop function if exists public.open_case(text, boolean);
drop function if exists public.open_case_batch(text, boolean, integer);
-- bj actions return setof blackjack_hands (table type); drop to be safe after
-- the table's bet column widening alters the effective rowtype.
drop function if exists public.bj_insurance(uuid, boolean);
drop function if exists public.bj_double(uuid);
drop function if exists public.bj_split(uuid);


-- ============================================================================
-- 3. Recreate all affected functions with bigint
-- ============================================================================


-- ─── play_coinflip ───────────────────────────────────────────────────────────

create or replace function public.play_coinflip(p_amount bigint, p_side text)
returns table(new_balance bigint, won boolean, result text, payout bigint)
language plpgsql security definer set search_path = public as $$
declare
  uid  uuid := auth.uid();
  flip text;
  win  boolean;
  pay  bigint := 0;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_side not in ('heads','tails') then raise exception 'Invalid side'; end if;
  if p_amount < 1 then raise exception 'Bet must be at least 1'; end if;

  perform public._apply_credit_delta(uid, -p_amount, 'game_coinflip',
    jsonb_build_object('phase','wager','side',p_side));

  flip := case when (random() < 0.5) then 'heads' else 'tails' end;
  win  := flip = p_side;
  if win then
    pay := (p_amount * 195) / 100;
    perform public._apply_credit_delta(uid, pay, 'game_coinflip',
      jsonb_build_object('phase','win','result',flip));
  else
    perform public._apply_credit_delta(uid, 0, 'game_coinflip',
      jsonb_build_object('phase','loss','result',flip));
  end if;

  return query select p.credits, win, flip, pay from public.profiles p where p.id = uid;
end; $$;
grant execute on function public.play_coinflip(bigint, text) to authenticated;


-- ─── play_dice ───────────────────────────────────────────────────────────────

create or replace function public.play_dice(p_amount bigint, p_target integer, p_over boolean)
returns table(new_balance bigint, won boolean, roll integer, multiplier numeric, payout bigint)
language plpgsql security definer set search_path = public as $$
declare
  uid        uuid    := auth.uid();
  r          integer;
  win_chance numeric;
  mult       numeric;
  win        boolean;
  pay        bigint  := 0;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_target < 4 or p_target > 96 then raise exception 'Target out of range'; end if;
  if p_amount < 1 then raise exception 'Bet must be at least 1'; end if;

  perform public._apply_credit_delta(uid, -p_amount, 'game_dice',
    jsonb_build_object('phase','wager','target',p_target,'over',p_over));

  r := floor(random()*100)::int + 1;
  if p_over then
    win        := r > p_target;
    win_chance := (100 - p_target)::numeric / 100;
  else
    win        := r < p_target;
    win_chance := (p_target - 1)::numeric / 100;
  end if;

  mult := round((0.97 / nullif(win_chance,0))::numeric, 4);
  if win then
    pay := floor(p_amount * mult)::bigint;
    perform public._apply_credit_delta(uid, pay, 'game_dice',
      jsonb_build_object('phase','win','roll',r,'mult',mult));
  else
    perform public._apply_credit_delta(uid, 0, 'game_dice',
      jsonb_build_object('phase','loss','roll',r));
  end if;

  return query select p.credits, win, r, mult, pay from public.profiles p where p.id = uid;
end; $$;
grant execute on function public.play_dice(bigint, integer, boolean) to authenticated;


-- ─── play_roulette ───────────────────────────────────────────────────────────
-- Signature unchanged (jsonb) — only internal variables and return cols change.

create or replace function public.play_roulette(p_bets jsonb)
returns table(new_balance bigint, roll integer, color text, total_wager bigint, total_payout bigint, breakdown jsonb)
language plpgsql security definer set search_path = public as $$
declare
  uid         uuid    := auth.uid();
  total_w     bigint  := 0;
  total_p     bigint  := 0;
  bet         jsonb;
  amt         bigint;
  btype       text;
  bval        text;
  r           integer;
  c           text;
  bd          jsonb   := '[]'::jsonb;
  payout_mult integer;
  win         boolean;
  reds int[] := array[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if jsonb_typeof(p_bets) <> 'array' or jsonb_array_length(p_bets) = 0 then
    raise exception 'No bets';
  end if;

  for bet in select * from jsonb_array_elements(p_bets) loop
    amt := (bet->>'amount')::bigint;
    if amt is null or amt < 1 then raise exception 'Invalid bet amount'; end if;
    total_w := total_w + amt;
  end loop;

  perform public._apply_credit_delta(uid, -total_w, 'game_roulette',
    jsonb_build_object('phase','wager','bets',p_bets));

  r := floor(random()*37)::int;
  c := case
         when r = 0 then 'green'
         when r = any(reds) then 'red'
         else 'black'
       end;

  for bet in select * from jsonb_array_elements(p_bets) loop
    btype := bet->>'type';
    bval  := bet->>'value';
    amt   := (bet->>'amount')::bigint;
    payout_mult := 0;
    win := false;

    if    btype = 'number' and r = bval::int                             then payout_mult := 36;
    elsif btype = 'red'    and c = 'red'                                 then payout_mult := 2;
    elsif btype = 'black'  and c = 'black'                               then payout_mult := 2;
    elsif btype = 'even'   and r <> 0 and r % 2 = 0                     then payout_mult := 2;
    elsif btype = 'odd'    and r <> 0 and r % 2 = 1                     then payout_mult := 2;
    elsif btype = 'low'    and r between 1 and 18                        then payout_mult := 2;
    elsif btype = 'high'   and r between 19 and 36                       then payout_mult := 2;
    elsif btype = 'dozen'  and r between (bval::int-1)*12+1 and bval::int*12 then payout_mult := 3;
    elsif btype = 'column' and r <> 0 and ((r-1) % 3) + 1 = bval::int  then payout_mult := 3;
    end if;

    if payout_mult > 0 then
      total_p := total_p + amt * payout_mult;
      win := true;
    end if;
    bd := bd || jsonb_build_object('type',btype,'value',bval,'amount',amt,'win',win,'mult',payout_mult);
  end loop;

  if total_p > 0 then
    perform public._apply_credit_delta(uid, total_p, 'game_roulette',
      jsonb_build_object('phase','payout','roll',r,'color',c));
  else
    perform public._apply_credit_delta(uid, 0, 'game_roulette',
      jsonb_build_object('phase','loss','roll',r,'color',c));
  end if;

  return query
    select p.credits, r, c, total_w, total_p, bd
      from public.profiles p where p.id = uid;
end; $$;
grant execute on function public.play_roulette(jsonb) to authenticated;


-- ─── play_blackjack (single-shot) ───────────────────────────────────────────

create or replace function public.play_blackjack(p_amount bigint, p_stand_at integer)
returns table(new_balance bigint, outcome text, player_total int, dealer_total int,
              player_hand int[], dealer_hand int[], payout bigint)
language plpgsql security definer set search_path = public as $$
declare
  uid  uuid := auth.uid();
  deck int[]; ph int[] := '{}'; dh int[] := '{}';
  pi int := 0; di int := 0;
  card int; pt int; dt int;
  pay  bigint := 0;
  res  text;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_amount < 1 then raise exception 'Bet must be at least 1'; end if;
  if p_stand_at < 12 or p_stand_at > 21 then raise exception 'stand_at must be 12..21'; end if;

  perform public._apply_credit_delta(uid, -p_amount, 'game_blackjack',
    jsonb_build_object('phase','wager','stand_at',p_stand_at));

  with raw as (
    select case when ((g-1) % 13)+1 > 10 then 10 else ((g-1) % 13)+1 end as v
      from generate_series(1,52) g
  )
  select array_agg(v order by random()) into deck from raw;

  ph := array[deck[1], deck[3]];
  dh := array[deck[2], deck[4]];
  di := 5;

  pt := bj_total(ph);
  while pt < p_stand_at loop
    ph := ph || deck[di];
    di := di + 1;
    pt := bj_total(ph);
    exit when pt >= 21;
  end loop;

  if pt <= 21 then
    dt := bj_total(dh);
    while dt < 17 loop
      dh := dh || deck[di];
      di := di + 1;
      dt := bj_total(dh);
    end loop;
  else
    dt := bj_total(dh);
  end if;

  if pt > 21 then
    res := 'bust'; pay := 0;
  elsif dt > 21 or pt > dt then
    res := case when pt = 21 and array_length(ph,1) = 2 then 'blackjack' else 'win' end;
    pay := case when res = 'blackjack' then (p_amount * 25) / 10 else p_amount * 2 end;
  elsif pt = dt then
    res := 'push'; pay := p_amount;
  else
    res := 'lose'; pay := 0;
  end if;

  if pay > 0 then
    perform public._apply_credit_delta(uid, pay, 'game_blackjack',
      jsonb_build_object('phase','payout','outcome',res,'pt',pt,'dt',dt));
  else
    perform public._apply_credit_delta(uid, 0, 'game_blackjack',
      jsonb_build_object('phase','loss','outcome',res,'pt',pt,'dt',dt));
  end if;

  return query select p.credits, res, pt, dt, ph, dh, pay
    from public.profiles p where p.id = uid;
end; $$;
grant execute on function public.play_blackjack(bigint, integer) to authenticated;


-- ─── play_crash ──────────────────────────────────────────────────────────────

create or replace function public.play_crash(p_amount bigint, p_cashout numeric)
returns table(new_balance bigint, won boolean, crash_point numeric, payout bigint)
language plpgsql security definer set search_path = public as $$
declare
  uid uuid    := auth.uid();
  cp  numeric;
  win boolean;
  pay bigint  := 0;
  rnd numeric;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_amount < 1 then raise exception 'Bet must be at least 1'; end if;
  if p_cashout < 1.01 or p_cashout > 100 then raise exception 'Cashout out of range'; end if;

  perform public._apply_credit_delta(uid, -p_amount, 'game_crash',
    jsonb_build_object('phase','wager','cashout',p_cashout));

  rnd := random();
  if rnd < 0.04 then
    cp := 1.00;
  else
    cp := round((0.96 / (1 - rnd))::numeric, 2);
    if cp > 100 then cp := 100; end if;
  end if;

  win := cp >= p_cashout;
  if win then
    pay := floor(p_amount * p_cashout)::bigint;
    perform public._apply_credit_delta(uid, pay, 'game_crash',
      jsonb_build_object('phase','win','crash',cp));
  else
    perform public._apply_credit_delta(uid, 0, 'game_crash',
      jsonb_build_object('phase','loss','crash',cp));
  end if;

  return query select p.credits, win, cp, pay from public.profiles p where p.id = uid;
end; $$;
grant execute on function public.play_crash(bigint, numeric) to authenticated;


-- ─── bj_start (interactive blackjack) ───────────────────────────────────────

create or replace function public.bj_start(p_amount bigint)
returns setof public.blackjack_hands
language plpgsql security definer set search_path = public as $$
declare
  uid           uuid := auth.uid();
  d             int[];
  pcards        int[]; dcards int[];
  pt            int;   dt     int;
  player_bj     bool;  dealer_up_ace bool;
  hand_id       uuid   := gen_random_uuid();
  hands_arr     jsonb;
  st            text;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_amount < 1 then raise exception 'Bet must be at least 1'; end if;

  update public.blackjack_hands
     set status = 'done', resolved_at = now(),
         outcome_summary = jsonb_build_object('abandoned',true)
   where user_id = uid and status <> 'done';

  perform public._apply_credit_delta(uid, -p_amount, 'game_blackjack',
    jsonb_build_object('phase','wager','hand_id',hand_id));

  select array_agg(c order by random())
    into d from generate_series(0,51) c;

  pcards := array[d[1], d[3]];
  dcards := array[d[2], d[4]];
  d      := d[5:];

  pt := public.bj_hand_total(pcards);
  dt := public.bj_hand_total(dcards);
  player_bj     := pt = 21;
  dealer_up_ace := public.bj_card_rank(dcards[1]) = 1;

  hands_arr := jsonb_build_array(jsonb_build_object(
    'cards',       to_jsonb(pcards),
    'bet',         p_amount,
    'doubled',     false,
    'done',        player_bj,
    'surrendered', false,
    'blackjack',   player_bj
  ));

  if dealer_up_ace then st := 'awaiting_insurance';
  else                  st := 'active';
  end if;

  insert into public.blackjack_hands
    (id, user_id, bet, deck, dealer_cards, hands, active_hand, status)
    values (hand_id, uid, p_amount, d, dcards, hands_arr, 0, st);

  if player_bj and not dealer_up_ace then
    perform public._bj_finalize(hand_id);
  end if;

  return query select * from public.blackjack_hands where id = hand_id;
end; $$;
grant execute on function public.bj_start(bigint) to authenticated;


-- ─── _bj_finalize (internal — fix payout variables) ─────────────────────────

create or replace function public._bj_finalize(p_hand_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  h           public.blackjack_hands%rowtype;
  dt          int; pt int;
  any_alive   boolean := false;
  e           jsonb;
  arr         jsonb   := '[]'::jsonb;
  bet_amt     bigint;
  pcards      int[];
  payout      bigint;
  result      text;
  is_bj       bool;
  i           int  := 0;
  tot_payout  bigint := 0;
begin
  select * into h from public.blackjack_hands where id = p_hand_id for update;
  if not found then return; end if;
  if h.status = 'done' then return; end if;

  for e in select value from jsonb_array_elements(h.hands) loop
    pcards := array(select (jsonb_array_elements_text(e->'cards'))::int);
    if not coalesce((e->>'surrendered')::bool, false)
       and not coalesce((e->>'blackjack')::bool, false)
       and public.bj_hand_total(pcards) <= 21 then
      any_alive := true;
      exit;
    end if;
  end loop;

  if any_alive then
    dt := public.bj_hand_total(h.dealer_cards);
    while dt < 17 loop
      h.dealer_cards := h.dealer_cards || h.deck[1];
      h.deck := h.deck[2:];
      dt := public.bj_hand_total(h.dealer_cards);
    end loop;
  else
    dt := public.bj_hand_total(h.dealer_cards);
  end if;

  for e in select value from jsonb_array_elements(h.hands) loop
    bet_amt := (e->>'bet')::bigint;
    pcards  := array(select (jsonb_array_elements_text(e->'cards'))::int);
    pt      := public.bj_hand_total(pcards);
    is_bj   := coalesce((e->>'blackjack')::bool, false);
    payout  := 0;

    if coalesce((e->>'surrendered')::bool, false) then
      result := 'surrender'; payout := bet_amt / 2;
    elsif is_bj then
      result := 'blackjack'; payout := (bet_amt * 5) / 2;
    elsif pt > 21 then
      result := 'bust'; payout := 0;
    elsif dt > 21 or pt > dt then
      result := 'win'; payout := bet_amt * 2;
    elsif pt = dt then
      result := 'push'; payout := bet_amt;
    else
      result := 'lose'; payout := 0;
    end if;

    if payout > 0 then
      perform public._apply_credit_delta(h.user_id, payout, 'game_blackjack',
        jsonb_build_object('phase','payout','hand',i,'result',result,'pt',pt,'dt',dt));
    else
      perform public._apply_credit_delta(h.user_id, 0, 'game_blackjack',
        jsonb_build_object('phase','loss','hand',i,'result',result,'pt',pt,'dt',dt));
    end if;
    tot_payout := tot_payout + payout;

    arr := arr || jsonb_build_array(jsonb_build_object(
      'cards',       e->'cards',
      'bet',         bet_amt,
      'doubled',     coalesce((e->>'doubled')::bool, false),
      'surrendered', coalesce((e->>'surrendered')::bool, false),
      'blackjack',   is_bj,
      'done',        true,
      'total',       pt,
      'result',      result,
      'payout',      payout
    ));
    i := i + 1;
  end loop;

  update public.blackjack_hands
     set hands           = arr,
         dealer_cards    = h.dealer_cards,
         deck            = h.deck,
         status          = 'done',
         outcome_summary = jsonb_build_object('dealer_total', dt, 'total_payout', tot_payout),
         resolved_at     = now()
   where id = h.id;
end; $$;


-- ─── bj_insurance ────────────────────────────────────────────────────────────

create or replace function public.bj_insurance(p_hand_id uuid, p_take boolean)
returns setof public.blackjack_hands
language plpgsql security definer set search_path = public as $$
declare
  h           public.blackjack_hands%rowtype;
  ins_amt     bigint;
  ins_payout  bigint := 0;
  dealer_bj   bool;
  hands_arr   jsonb := '[]'::jsonb;
begin
  select * into h from public.blackjack_hands where id = p_hand_id for update;
  if not found or h.user_id <> auth.uid() then raise exception 'Hand not found'; end if;
  if h.status <> 'awaiting_insurance' then raise exception 'No insurance offered'; end if;

  ins_amt := h.bet / 2;
  dealer_bj := public.bj_hand_total(h.dealer_cards) = 21;

  if p_take then
    perform public._apply_credit_delta(h.user_id, -ins_amt, 'game_blackjack',
      jsonb_build_object('phase','insurance','hand_id',h.id));
    if dealer_bj then
      ins_payout := ins_amt * 3;
      perform public._apply_credit_delta(h.user_id, ins_payout, 'game_blackjack',
        jsonb_build_object('phase','insurance_payout','hand_id',h.id));
    end if;
  end if;

  update public.blackjack_hands
     set insurance_bet = case when p_take then ins_amt else 0 end,
         insurance_resolved = true,
         status = 'active'
   where id = h.id;

  if dealer_bj then
    perform public._bj_finalize(h.id);
  else
    select hands into hands_arr from public.blackjack_hands where id = h.id;
    if (hands_arr->0->>'blackjack')::bool then
      perform public._bj_finalize(h.id);
    end if;
  end if;

  return query select * from public.blackjack_hands where id = h.id;
end; $$;
grant execute on function public.bj_insurance(uuid, boolean) to authenticated;


-- ─── bj_double ───────────────────────────────────────────────────────────────

create or replace function public.bj_double(p_hand_id uuid)
returns setof public.blackjack_hands
language plpgsql security definer set search_path = public as $$
declare
  h           public.blackjack_hands%rowtype;
  hand        jsonb; cards int[]; new_card int; bet_amt bigint; pt int;
  cur_credits bigint;
  arr         jsonb := '[]'::jsonb; e jsonb; i int := 0;
begin
  select * into h from public.blackjack_hands where id = p_hand_id for update;
  if not found or h.user_id <> auth.uid() then raise exception 'Hand not found'; end if;
  if h.status <> 'active' then raise exception 'Hand not active'; end if;

  hand    := h.hands -> h.active_hand;
  cards   := array(select (jsonb_array_elements_text(hand->'cards'))::int);
  if array_length(cards,1) <> 2 then raise exception 'Can only double on first 2 cards'; end if;
  bet_amt := (hand->>'bet')::bigint;

  select credits into cur_credits from public.profiles where id = h.user_id for update;
  if cur_credits is null or cur_credits < bet_amt then
    raise exception 'Not enough credits to double';
  end if;

  perform public._apply_credit_delta(h.user_id, -bet_amt, 'game_blackjack',
    jsonb_build_object('phase','double','hand',h.active_hand));

  new_card := h.deck[1];
  cards    := cards || new_card;
  pt       := public.bj_hand_total(cards);

  for e in select value from jsonb_array_elements(h.hands) loop
    if i = h.active_hand then
      e := jsonb_set(e, '{cards}',  to_jsonb(cards));
      e := jsonb_set(e, '{bet}',    to_jsonb(bet_amt * 2));
      e := jsonb_set(e, '{doubled}','true'::jsonb);
      e := jsonb_set(e, '{done}',   'true'::jsonb);
    end if;
    arr := arr || jsonb_build_array(e);
    i   := i + 1;
  end loop;

  update public.blackjack_hands set hands = arr, deck = h.deck[2:] where id = h.id;
  perform public._bj_advance(h.id);
  return query select * from public.blackjack_hands where id = h.id;
end; $$;
grant execute on function public.bj_double(uuid) to authenticated;


-- ─── bj_split ────────────────────────────────────────────────────────────────

create or replace function public.bj_split(p_hand_id uuid)
returns setof public.blackjack_hands
language plpgsql security definer set search_path = public as $$
declare
  h           public.blackjack_hands%rowtype;
  hand        jsonb; cards int[]; r1 int; r2 int; bet_amt bigint;
  c1          int;   c2 int; nc1 int; nc2 int;
  is_aces     bool;
  hand1       jsonb; hand2 jsonb;
  cur_credits bigint;
begin
  select * into h from public.blackjack_hands where id = p_hand_id for update;
  if not found or h.user_id <> auth.uid() then raise exception 'Hand not found'; end if;
  if h.status <> 'active' then raise exception 'Hand not active'; end if;
  if jsonb_array_length(h.hands) <> 1 then raise exception 'Already split'; end if;

  hand := h.hands -> 0;
  cards := array(select (jsonb_array_elements_text(hand->'cards'))::int);
  if array_length(cards,1) <> 2 then raise exception 'Can only split on first 2 cards'; end if;

  r1 := public.bj_card_rank(cards[1]);
  r2 := public.bj_card_rank(cards[2]);
  if not (r1 = r2 or (r1 >= 10 and r2 >= 10)) then
    raise exception 'Cards must be the same rank to split';
  end if;

  bet_amt := (hand->>'bet')::bigint;
  select credits into cur_credits from public.profiles where id = h.user_id for update;
  if cur_credits is null or cur_credits < bet_amt then
    raise exception 'Not enough credits to split';
  end if;

  perform public._apply_credit_delta(h.user_id, -bet_amt, 'game_blackjack',
    jsonb_build_object('phase','split','hand_id',h.id));

  c1 := cards[1]; c2 := cards[2];
  nc1 := h.deck[1]; nc2 := h.deck[2];
  is_aces := r1 = 1;

  hand1 := jsonb_build_object(
    'cards',       to_jsonb(array[c1, nc1]),
    'bet',         bet_amt,
    'doubled',     false,
    'done',        is_aces or public.bj_hand_total(array[c1,nc1]) >= 21,
    'surrendered', false,
    'blackjack',   false
  );
  hand2 := jsonb_build_object(
    'cards',       to_jsonb(array[c2, nc2]),
    'bet',         bet_amt,
    'doubled',     false,
    'done',        is_aces or public.bj_hand_total(array[c2,nc2]) >= 21,
    'surrendered', false,
    'blackjack',   false
  );

  update public.blackjack_hands
     set hands = jsonb_build_array(hand1, hand2),
         deck  = h.deck[3:],
         active_hand = 0
   where id = h.id;

  if is_aces or (public.bj_hand_total(array[c1,nc1]) >= 21 and public.bj_hand_total(array[c2,nc2]) >= 21) then
    perform public._bj_finalize(h.id);
  end if;

  return query select * from public.blackjack_hands where id = h.id;
end; $$;
grant execute on function public.bj_split(uuid) to authenticated;


-- ─── play_plinko ─────────────────────────────────────────────────────────────

create or replace function public.play_plinko(
  p_bet  bigint,
  p_rows integer default 8,
  p_risk text    default 'medium'
) returns table (
  new_balance bigint,
  path        boolean[],
  bin_index   int,
  multiplier  numeric,
  payout      bigint,
  won         boolean
)
language plpgsql security definer set search_path = public as $$
declare
  uid    uuid    := auth.uid();
  prof   public.profiles%rowtype;
  rows_  int     := coalesce(p_rows, 8);
  risk_  text    := coalesce(p_risk, 'medium');
  path_  boolean[];
  bin    int;
  mult   numeric;
  pay    bigint;
  did_win boolean;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not public.is_game_active('plinko') then
    raise exception 'Plinko is currently out of rotation';
  end if;
  if p_bet is null or p_bet < 1 then raise exception 'bet must be >= 1'; end if;
  if rows_ < 4 or rows_ > 12 then raise exception 'rows must be 4..12'; end if;
  if risk_ not in ('low','medium','high') then raise exception 'risk must be low/medium/high'; end if;

  select * into prof from public.profiles where id = uid for update;
  if prof.credits < p_bet then raise exception 'Not enough credits (need %)', p_bet; end if;

  perform public._apply_credit_delta(uid, -p_bet, 'plinko',
    jsonb_build_object('phase','wager','rows',rows_,'risk',risk_));

  select s.path, s.bin_index, s.multiplier
    into path_, bin, mult
    from public._plinko_spin(rows_, risk_) s;

  pay     := floor(p_bet::numeric * mult)::bigint;
  did_win := pay > p_bet;

  if pay > 0 then
    perform public._apply_credit_delta(uid, pay, 'plinko',
      jsonb_build_object('phase','payout','rows',rows_,'risk',risk_,'bin',bin,'mult',mult,'payout',pay));
  end if;

  insert into public.plinko_drops (user_id, bet, rows_used, risk, path, bin_index, multiplier, payout)
    values (uid, p_bet, rows_, risk_, path_, bin, mult, pay);

  select credits into new_balance from public.profiles where id = uid;
  return query select new_balance, path_, bin, mult, pay, did_win;
end; $$;
grant execute on function public.play_plinko(bigint, integer, text) to authenticated;


-- ─── minesweeper_start ───────────────────────────────────────────────────────

create or replace function public.minesweeper_start(p_bet bigint, p_mines integer)
returns table (
  id          uuid,
  new_balance bigint,
  bet         bigint,
  mines       integer
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  uid    uuid := auth.uid();
  prof   public.profiles%rowtype;
  gid    uuid;
  layout integer[];
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  perform public._txn_user_lock('mines_start');

  if not public.is_game_active('mines') then
    raise exception 'Minesweeper is currently out of rotation';
  end if;
  if p_bet is null or p_bet < 1 then raise exception 'bet must be >= 1'; end if;
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
  id    := gid;
  bet   := p_bet;
  mines := p_mines;
  return next;
end; $$;
grant execute on function public.minesweeper_start(bigint, integer) to authenticated;


-- ─── minesweeper_reveal ──────────────────────────────────────────────────────

create or replace function public.minesweeper_reveal(p_id uuid, p_cell integer)
returns table (
  status            text,
  revealed          integer[],
  hit_mine          boolean,
  mult_bp           integer,
  current_multi     numeric,
  mines_revealed    integer[],
  potential_payout  bigint,
  new_balance       bigint
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  uid            uuid := auth.uid();
  g              public.minesweeper_games%rowtype;
  is_mine        boolean;
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
       set status = 'busted', finished_at = now(), payout = 0
     where id = p_id
     returning * into g;

    status          := 'busted';
    revealed        := g.revealed;
    hit_mine        := true;
    mult_bp         := 0;
    current_multi   := 0;
    mines_revealed  := g.mines_layout;
    potential_payout := 0;
    select credits into new_balance from public.profiles where id = uid;
    return next;
    return;
  end if;

  update public.minesweeper_games
     set revealed = revealed || p_cell
   where id = p_id
   returning * into g;

  revealed_count   := cardinality(g.revealed);
  mult_bp          := public._mines_mult_bp(g.mines, revealed_count);

  status           := 'active';
  revealed         := g.revealed;
  hit_mine         := false;
  current_multi    := mult_bp::numeric / 10000;
  mines_revealed   := '{}'::int[];
  potential_payout := floor(g.bet::numeric * mult_bp / 10000)::bigint;
  select credits into new_balance from public.profiles where id = uid;
  return next;
end; $$;
grant execute on function public.minesweeper_reveal(uuid, integer) to authenticated;


-- ─── minesweeper_cashout ─────────────────────────────────────────────────────

create or replace function public.minesweeper_cashout(p_id uuid)
returns table (
  payout         bigint,
  mult_bp        integer,
  new_balance    bigint,
  mines_revealed integer[]
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  uid       uuid    := auth.uid();
  g         public.minesweeper_games%rowtype;
  rev_count integer;
  mb        integer;
  pay       bigint;
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
  pay := floor(g.bet::numeric * mb / 10000)::bigint;

  perform public._apply_credit_delta(uid, pay, 'mines_cashout',
    jsonb_build_object('game_id', g.id, 'mines', g.mines,
                       'revealed', rev_count, 'mult_bp', mb));

  update public.minesweeper_games
     set status = 'cashed_out', finished_at = now(), payout = pay
   where id = p_id;

  payout         := pay;
  mult_bp        := mb;
  select credits into new_balance from public.profiles where id = uid;
  mines_revealed := g.mines_layout;
  return next;
end; $$;
grant execute on function public.minesweeper_cashout(uuid) to authenticated;


-- ─── candy_spin ──────────────────────────────────────────────────────────────

create or replace function public.candy_spin(p_bet bigint)
returns table (
  id          uuid,
  payout      bigint,
  cascades    integer,
  snapshots   jsonb,
  new_balance bigint
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  uid          uuid := auth.uid();
  prof         public.profiles%rowtype;
  board        integer[];
  i            integer;
  matches      integer[];
  matched_count integer;
  match_groups jsonb;
  gross_payout bigint   := 0;
  steps        jsonb    := '[]'::jsonb;
  round_no     integer  := 0;
  cap          bigint;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  perform public._txn_user_lock('candy_spin');

  if not public.is_game_active('candy') then
    raise exception 'Candy Crush is currently out of rotation';
  end if;
  if p_bet is null or p_bet < 1 then raise exception 'bet must be >= 1'; end if;

  select * into prof from public.profiles where id = uid for update;
  if prof.credits < p_bet then
    raise exception 'Not enough credits (need %)', p_bet;
  end if;

  perform public._apply_credit_delta(uid, -p_bet, 'candy_bet', '{}'::jsonb);

  board := array(select floor(random() * 6)::int from generate_series(1, 36));

  steps := steps || jsonb_build_object('kind', 'initial', 'board', to_jsonb(board));

  cap := p_bet * 8;

  loop
    round_no := round_no + 1;
    matches  := public._candy_find_matches(board);
    matched_count := coalesce(cardinality(matches), 0);
    exit when matched_count = 0 or round_no > 8;

    declare
      round_pay bigint;
    begin
      round_pay := floor(matched_count * p_bet::numeric * 0.18)::bigint;
      if matched_count >= 8  then round_pay := round_pay + floor(p_bet::numeric * 0.4)::bigint; end if;
      if matched_count >= 12 then round_pay := round_pay + floor(p_bet::numeric * 1.0)::bigint; end if;
      gross_payout := least(cap, gross_payout + round_pay);

      match_groups := to_jsonb(matches);
      steps := steps || jsonb_build_object(
        'kind',        'match',
        'round',       round_no,
        'cells',       match_groups,
        'round_pay',   round_pay,
        'board_before', to_jsonb(board)
      );
    end;

    for i in 1..36 loop
      if (i - 1) = any (matches) then board[i] := -1; end if;
    end loop;

    board := public._candy_gravity_refill(board);

    steps := steps || jsonb_build_object(
      'kind',  'refill',
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

  payout   := gross_payout;
  cascades := greatest(0, round_no - 1);
  snapshots := steps;
  select credits into new_balance from public.profiles where id = uid;
  return next;
end; $$;
grant execute on function public.candy_spin(bigint) to authenticated;


-- ─── play_lottery ────────────────────────────────────────────────────────────

create or replace function public.play_lottery(
  p_bet   bigint,
  p_picks integer[]
) returns table (
  new_balance bigint,
  drawn       integer[],
  matches     integer,
  multiplier  numeric,
  payout      bigint,
  won         boolean
) language plpgsql security definer set search_path = public as $$
declare
  v_user_id  uuid    := auth.uid();
  v_balance  bigint;
  v_picks    int[];
  v_drawn    int[];
  v_matches  int;
  v_mult     numeric;
  v_payout   bigint;
  v_pool     int[]   := array(select generate_series(1, 36));
  v_slot     int;
  v_idx      int;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = 'P0001';
  end if;
  if p_bet <= 0 then
    raise exception 'Bet must be > 0' using errcode = 'P0001';
  end if;

  select credits into v_balance
    from public.profiles where id = v_user_id for update;

  if v_balance < p_bet then
    raise exception 'Not enough credits' using errcode = 'P0001';
  end if;

  v_picks := array(select distinct unnest(p_picks) order by 1);
  if array_length(v_picks, 1) != 5 then
    raise exception 'Pick exactly 5 unique numbers' using errcode = 'P0001';
  end if;
  if v_picks[1] < 1 or v_picks[array_length(v_picks,1)] > 36 then
    raise exception 'Numbers must be 1-36' using errcode = 'P0001';
  end if;

  v_drawn := '{}';
  for v_idx in 1..5 loop
    v_slot   := 1 + floor(random() * (36 - v_idx + 1))::int;
    v_drawn  := array_append(v_drawn, v_pool[v_slot]);
    v_pool[v_slot] := v_pool[36 - v_idx + 1];
  end loop;

  select count(*) into v_matches
    from unnest(v_picks) p
    where p = any(v_drawn);

  select lp.multiplier into v_mult
    from public.lottery_payout lp
    where lp.matches = v_matches;

  v_payout := floor(p_bet * v_mult)::bigint;

  update public.profiles
     set credits = credits - p_bet + v_payout
   where id = v_user_id
   returning credits into v_balance;

  insert into public.lottery_draws (user_id, bet, picks, drawn, matches, multiplier, payout)
    values (v_user_id, p_bet, v_picks, v_drawn, v_matches, v_mult, v_payout);

  insert into public.transactions (user_id, delta, balance_after, kind, meta)
    values (v_user_id, v_payout - p_bet, v_balance, 'lottery', jsonb_build_object(
      'bet', p_bet, 'picks', v_picks, 'drawn', v_drawn,
      'matches', v_matches, 'multiplier', v_mult
    ));

  return query select v_balance, v_drawn, v_matches, v_mult, v_payout, (v_payout > p_bet);
end;
$$;
grant execute on function public.play_lottery(bigint, integer[]) to authenticated;


-- ─── gacha_pull (new_balance variable only) ──────────────────────────────────

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
  new_balance   bigint,
  new_pity      integer
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  uid           uuid    := auth.uid();
  cost_total    bigint;
  per_pull      bigint  := 100;
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
         order by id for update
      loop
        cum_w := cum_w + r.weight;
        if cum_w >= pick_w then picked := r; exit; end if;
      end loop;
    else
      for r in
        select * from public.gacha_pool
         where claimed_by is null
         order by id for update
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
      on conflict (user_id, item_id) do update set qty = user_items.qty + 1;

    insert into public.gacha_pulls
      (user_id, pool_id, item_id, rarity, cost, pity_popped)
    values
      (uid, picked.id, picked.item_id, picked.rarity, per_pull, forced_pity);

    if picked.rarity in ('legendary','mythic','one_of_one') then
      cur_pity := 0;
    end if;

    select * into it from public.market_items where id = picked.item_id;
    pulls_made := pulls_made || jsonb_build_object(
      'pull_index',  i,
      'item_id',     it.id,
      'item_slug',   it.slug,
      'item_name',   it.name,
      'item_emoji',  coalesce(it.metadata->>'emoji', '🎁'),
      'rarity',      picked.rarity,
      'is_unique',   picked.is_unique,
      'pity_popped', forced_pity
    );
  end loop;

  update public.profiles set gacha_pity = cur_pity where id = uid;

  for r in select * from jsonb_array_elements(pulls_made) as e(p) loop
    pull_index  := (r.p->>'pull_index')::int;
    item_id     := (r.p->>'item_id')::uuid;
    item_slug   := r.p->>'item_slug';
    item_name   := r.p->>'item_name';
    item_emoji  := r.p->>'item_emoji';
    rarity      := r.p->>'rarity';
    is_unique   := (r.p->>'is_unique')::boolean;
    pity_popped := (r.p->>'pity_popped')::boolean;
    select credits into new_balance from public.profiles where id = uid;
    new_pity    := cur_pity;
    return next;
  end loop;
end; $$;
grant execute on function public.gacha_pull(integer) to authenticated;


-- ─── play_warfront ───────────────────────────────────────────────────────────

create or replace function public.play_warfront(
  p_bet           bigint,
  p_picks         text[],
  p_collection    text    default 'fantasy',
  p_draft_budget  integer default 10
) returns table (
  game_id          uuid,
  enemy_army       jsonb,
  enemy_difficulty text,
  enemy_budget     integer
) language plpgsql security definer set search_path = public as $$
declare
  v_user_id    uuid := auth.uid();
  v_is_admin   boolean;
  v_total_cost int := 0;
  v_u          jsonb;
  v_id         text;
  v_e_budget   int;
  v_e_army     jsonb;
  v_diff_name  text;
  v_game_id    uuid;
  v_active_pool text[];
  v_i          int;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  if p_bet < 10 then raise exception 'Bet must be at least 10'; end if;
  if array_length(p_picks,1) is null or array_length(p_picks,1) > 6 then
    raise exception 'Pick between 1 and 6 units';
  end if;
  if p_collection not in ('fantasy','animals') then
    raise exception 'Invalid collection: %', p_collection;
  end if;

  select is_admin into v_is_admin from public.profiles where id = v_user_id;

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
    if not v_is_admin and not (v_id = any(v_active_pool)) then
      raise exception 'Unit % is not in the current rotation', v_id;
    end if;
    v_total_cost := v_total_cost + (v_u->>'cost')::int;
  end loop;

  if v_total_cost > p_draft_budget then
    raise exception 'Unit cost % exceeds draft budget %', v_total_cost, p_draft_budget;
  end if;

  perform public._apply_credit_delta(v_user_id, -p_bet, 'warfront',
    jsonb_build_object('phase','wager','picks',to_jsonb(p_picks),'collection',p_collection,'draft_budget',p_draft_budget));

  v_e_budget := p_draft_budget + case
    when random() < 0.15 then 1
    when random() < 0.30 then 2
    when random() < 0.55 then 3
    when random() < 0.80 then 4
    else 5
  end;
  v_e_army    := public._warfront_enemy_army(v_e_budget, p_collection, p_picks);
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
grant execute on function public.play_warfront(bigint, text[], text, integer) to authenticated;


-- ─── resolve_warfront ────────────────────────────────────────────────────────

create or replace function public.resolve_warfront(
  p_game_id        uuid,
  p_player_base_hp integer,
  p_enemy_base_hp  integer
) returns table (
  new_balance bigint,
  multiplier  numeric,
  payout      bigint,
  won         boolean
) language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid    := auth.uid();
  v_game    public.warfront_games%rowtype;
  v_won     boolean;
  v_mult    numeric := 0;
  v_payout  bigint  := 0;
  v_balance bigint;
begin
  select * into v_game from public.warfront_games
    where id = p_game_id and user_id = v_user_id;
  if not found then raise exception 'Game not found'; end if;
  if v_game.resolved then raise exception 'Game already resolved'; end if;

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
    if p_player_base_hp >= 100 then v_mult := v_mult * 1.5; end if;
    v_payout := floor(v_game.bet * v_mult)::bigint;
    if v_payout > 0 then
      perform public._apply_credit_delta(v_user_id, v_payout, 'warfront',
        jsonb_build_object('phase','reward','game_id',p_game_id,
          'player_base_hp',p_player_base_hp,'enemy_base_hp',p_enemy_base_hp,
          'multiplier',v_mult,'enemy_difficulty',v_game.enemy_difficulty));
    end if;
  end if;

  update public.warfront_games set
    resolved        = true,
    player_base_hp  = p_player_base_hp,
    enemy_base_hp   = p_enemy_base_hp,
    multiplier      = v_mult,
    payout          = v_payout
  where id = p_game_id;

  select credits into v_balance from public.profiles where id = v_user_id;
  return query select v_balance, v_mult, v_payout, v_won;
end;
$$;
grant execute on function public.resolve_warfront(uuid, integer, integer) to authenticated;


-- ─── open_case (fix internal variables; v52 already has latest body) ─────────

create or replace function public.open_case(p_tier text, p_key boolean default false)
returns table(
  new_balance bigint, tier text, rarity text, reward bigint,
  cost bigint, pity integer, pity_popped boolean, key_used boolean,
  multiplier numeric, dropped_item uuid
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  uid        uuid    := auth.uid();
  base_cost  bigint;
  final_cost bigint;
  r          numeric;
  rar        text;
  mult       numeric;
  rew        bigint;
  cur_pity   integer;
  pity_hit   boolean := false;
  item       uuid;
  guard      int;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not public.is_game_active('cases') then
    raise exception 'Cases is currently out of rotation';
  end if;
  perform public._txn_user_lock('open_case');

  case p_tier
    when 'bronze' then base_cost := 10;
    when 'silver' then base_cost := 50;
    when 'gold'   then base_cost := 100;
    else raise exception 'Unknown tier %', p_tier;
  end case;
  final_cost := case when p_key then (base_cost * 9) / 5 else base_cost end;

  select case_pity into cur_pity from public.profiles where id = uid for update;
  if cur_pity is null then cur_pity := 0; end if;

  perform public._apply_credit_delta(uid, -final_cost, 'game_case',
    jsonb_build_object('phase','wager','tier',p_tier,'key',p_key));

  r   := random();
  rar := public._case_pick_rarity(r);
  if p_key then
    guard := 0;
    while rar = 'common' and guard < 12 loop
      r   := random();
      rar := public._case_pick_rarity(r);
      guard := guard + 1;
    end loop;
    if rar = 'common' then rar := 'uncommon'; end if;
  end if;

  if not p_key and rar = 'common' and cur_pity >= 9 then
    rar      := 'rare';
    pity_hit := true;
  end if;

  mult := public._case_mult(rar);
  rew  := floor(base_cost * mult)::bigint;

  if rew > 0 then
    perform public._apply_credit_delta(uid, rew, 'game_case',
      jsonb_build_object('phase','reward','tier',p_tier,'rarity',rar,
        'key', p_key, 'pity_hit', pity_hit));
  else
    perform public._apply_credit_delta(uid, 0, 'game_case',
      jsonb_build_object('phase','loss','tier',p_tier,'rarity',rar,'key',p_key));
  end if;

  if not p_key then
    if rar = 'common' then cur_pity := cur_pity + 1;
    else                    cur_pity := 0;
    end if;
    update public.profiles set case_pity = cur_pity where id = uid;
  end if;

  insert into public.case_openings (user_id, tier, cost, rarity, reward, key_used, pity_popped)
    values (uid, p_tier, final_cost, rar, rew, p_key, pity_hit);

  item := public._case_maybe_drop_item(uid, rar, p_key);

  select credits into new_balance from public.profiles where id = uid;
  tier := p_tier; rarity := rar; reward := rew; cost := final_cost;
  pity := cur_pity; pity_popped := pity_hit; key_used := p_key;
  multiplier := mult; dropped_item := item;
  return next;
end; $$;
grant execute on function public.open_case(text, boolean) to authenticated;


-- ─── open_case_batch ─────────────────────────────────────────────────────────

create or replace function public.open_case_batch(
  p_tier text, p_key boolean, p_count integer
) returns table(
  idx integer, rarity text, reward bigint, mult numeric,
  pity_hit boolean, cost bigint, dropped_item uuid
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  uid        uuid    := auth.uid();
  base_cost  bigint;
  per_cost   bigint;
  total_cost bigint;
  cur_pity   integer;
  r          numeric;
  rar        text;
  m          numeric;
  rew        bigint;
  pit_hit    boolean;
  i          integer := 0;
  item       uuid;
  guard      int;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not public.is_game_active('cases') then
    raise exception 'Cases is currently out of rotation';
  end if;
  perform public._txn_user_lock('open_case');

  if p_count not in (3,5,10,20,50) then raise exception 'Batch size must be 3/5/10/20/50'; end if;

  case p_tier
    when 'bronze' then base_cost := 10;
    when 'silver' then base_cost := 50;
    when 'gold'   then base_cost := 100;
    else raise exception 'Unknown tier %', p_tier;
  end case;
  per_cost   := case when p_key then (base_cost * 9) / 5 else base_cost end;
  total_cost := per_cost * p_count;

  perform public._apply_credit_delta(uid, -total_cost, 'game_case',
    jsonb_build_object('phase','wager','tier',p_tier,'key',p_key,
      'batch_count', p_count, 'per_cost', per_cost));

  select case_pity into cur_pity from public.profiles where id = uid for update;
  if cur_pity is null then cur_pity := 0; end if;

  while i < p_count loop
    r   := random();
    rar := public._case_pick_rarity(r);
    if p_key then
      guard := 0;
      while rar = 'common' and guard < 12 loop
        r   := random();
        rar := public._case_pick_rarity(r);
        guard := guard + 1;
      end loop;
      if rar = 'common' then rar := 'uncommon'; end if;
    end if;
    pit_hit := false;
    if not p_key and rar = 'common' and cur_pity >= 9 then
      rar := 'rare'; pit_hit := true;
    end if;

    m   := public._case_mult(rar);
    rew := floor(base_cost * m)::bigint;

    if rew > 0 then
      perform public._apply_credit_delta(uid, rew, 'game_case',
        jsonb_build_object('phase','reward','tier',p_tier,'rarity',rar,
          'key', p_key, 'batch_idx', i, 'pity_hit', pit_hit));
    end if;

    if not p_key then
      if rar = 'common' then cur_pity := cur_pity + 1;
      else                    cur_pity := 0;
      end if;
    end if;

    insert into public.case_openings
      (user_id, tier, cost, rarity, reward, key_used, pity_popped)
      values (uid, p_tier, per_cost, rar, rew, p_key, pit_hit);

    item := public._case_maybe_drop_item(uid, rar, p_key);

    idx := i; rarity := rar; reward := rew; mult := m;
    pity_hit := pit_hit; cost := per_cost; dropped_item := item;
    return next;
    i := i + 1;
  end loop;

  update public.profiles set case_pity = cur_pity where id = uid;
end; $$;
grant execute on function public.open_case_batch(text, boolean, integer) to authenticated;


-- ============================================================================
-- Done.
-- ============================================================================
