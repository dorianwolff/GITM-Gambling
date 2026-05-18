-- ============================================================================
-- v42_remove_bet_caps.sql
-- Remove the per-game upper-bound bet caps so players can wager any amount
-- they have available.  Lower-bound (≥ 1) is kept to prevent zero/negative bets.
-- ============================================================================


-- ── play_coinflip ─────────────────────────────────────────────────────────────
create or replace function public.play_coinflip(p_amount integer, p_side text)
returns table(new_balance integer, won boolean, result text, payout integer)
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  flip text;
  win boolean;
  pay integer := 0;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_side not in ('heads','tails') then raise exception 'Invalid side'; end if;
  if p_amount < 1 then raise exception 'Bet must be at least 1'; end if;

  perform public._apply_credit_delta(uid, -p_amount, 'game_coinflip',
    jsonb_build_object('phase','wager','side',p_side));

  flip := case when (random() < 0.5) then 'heads' else 'tails' end;
  win := flip = p_side;
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
grant execute on function public.play_coinflip(integer,text) to authenticated;


-- ── play_dice ─────────────────────────────────────────────────────────────────
create or replace function public.play_dice(p_amount integer, p_target integer, p_over boolean)
returns table(new_balance integer, won boolean, roll integer, multiplier numeric, payout integer)
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  r integer;
  win_chance numeric;
  mult numeric;
  win boolean;
  pay integer := 0;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_target < 4 or p_target > 96 then raise exception 'Target out of range'; end if;
  if p_amount < 1 then raise exception 'Bet must be at least 1'; end if;

  perform public._apply_credit_delta(uid, -p_amount, 'game_dice',
    jsonb_build_object('phase','wager','target',p_target,'over',p_over));

  r := floor(random()*100)::int + 1;
  if p_over then
    win := r > p_target;
    win_chance := (100 - p_target)::numeric / 100;
  else
    win := r < p_target;
    win_chance := (p_target - 1)::numeric / 100;
  end if;

  mult := round( (0.97 / nullif(win_chance,0)) ::numeric, 4);
  if win then
    pay := floor(p_amount * mult)::int;
    perform public._apply_credit_delta(uid, pay, 'game_dice',
      jsonb_build_object('phase','win','roll',r,'mult',mult));
  else
    perform public._apply_credit_delta(uid, 0, 'game_dice',
      jsonb_build_object('phase','loss','roll',r));
  end if;

  return query select p.credits, win, r, mult, pay from public.profiles p where p.id = uid;
end; $$;
grant execute on function public.play_dice(integer,integer,boolean) to authenticated;


-- ── play_roulette ─────────────────────────────────────────────────────────────
create or replace function public.play_roulette(p_bets jsonb)
returns table(new_balance integer, roll integer, color text, total_wager integer, total_payout integer, breakdown jsonb)
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  total_w integer := 0;
  total_p integer := 0;
  bet jsonb;
  amt integer;
  btype text;
  bval text;
  r integer;
  c text;
  bd jsonb := '[]'::jsonb;
  payout_mult integer;
  win boolean;
  reds int[] := array[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if jsonb_typeof(p_bets) <> 'array' or jsonb_array_length(p_bets)=0 then
    raise exception 'No bets';
  end if;

  for bet in select * from jsonb_array_elements(p_bets) loop
    amt := (bet->>'amount')::int;
    if amt is null or amt < 1 then raise exception 'Invalid bet amount'; end if;
    total_w := total_w + amt;
  end loop;
  -- upper cap removed

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
    amt   := (bet->>'amount')::int;
    payout_mult := 0;
    win := false;

    if btype = 'number'      and r = bval::int then payout_mult := 36;
    elsif btype = 'red'      and c = 'red'    then payout_mult := 2;
    elsif btype = 'black'    and c = 'black'  then payout_mult := 2;
    elsif btype = 'even'     and r <> 0 and r % 2 = 0 then payout_mult := 2;
    elsif btype = 'odd'      and r <> 0 and r % 2 = 1 then payout_mult := 2;
    elsif btype = 'low'      and r between 1 and 18  then payout_mult := 2;
    elsif btype = 'high'     and r between 19 and 36 then payout_mult := 2;
    elsif btype = 'dozen' and r between (bval::int-1)*12+1 and bval::int*12 then payout_mult := 3;
    elsif btype = 'column' and r <> 0 and ((r-1) % 3) + 1 = bval::int then payout_mult := 3;
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


-- ── play_blackjack (single-shot) ─────────────────────────────────────────────
create or replace function public.play_blackjack(p_amount integer, p_stand_at integer)
returns table(new_balance integer, outcome text, player_total int, dealer_total int,
              player_hand int[], dealer_hand int[], payout integer)
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  deck int[]; ph int[] := '{}'; dh int[] := '{}';
  pi int := 0; di int := 0;
  card int; pt int; dt int;
  pay integer := 0;
  res text;
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
    res := 'bust';
    pay := 0;
  elsif dt > 21 or pt > dt then
    res := case when pt = 21 and array_length(ph,1) = 2 then 'blackjack' else 'win' end;
    pay := case when res = 'blackjack' then (p_amount * 25) / 10 else p_amount * 2 end;
  elsif pt = dt then
    res := 'push';
    pay := p_amount;
  else
    res := 'lose';
    pay := 0;
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
grant execute on function public.play_blackjack(integer,integer) to authenticated;


-- ── play_crash ────────────────────────────────────────────────────────────────
create or replace function public.play_crash(p_amount integer, p_cashout numeric)
returns table(new_balance integer, won boolean, crash_point numeric, payout integer)
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  cp numeric;
  win boolean;
  pay integer := 0;
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
    cp := round( (0.96 / (1 - rnd))::numeric, 2);
    if cp > 100 then cp := 100; end if;
  end if;

  win := cp >= p_cashout;
  if win then
    pay := floor(p_amount * p_cashout)::int;
    perform public._apply_credit_delta(uid, pay, 'game_crash',
      jsonb_build_object('phase','win','crash',cp));
  else
    perform public._apply_credit_delta(uid, 0, 'game_crash',
      jsonb_build_object('phase','loss','crash',cp));
  end if;

  return query select p.credits, win, cp, pay from public.profiles p where p.id = uid;
end; $$;
grant execute on function public.play_crash(integer,numeric) to authenticated;


-- ── bj_start (interactive blackjack) ─────────────────────────────────────────
create or replace function public.bj_start(p_amount integer)
returns setof public.blackjack_hands
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  d int[];
  pcards int[]; dcards int[];
  pt int; dt int;
  player_bj bool; dealer_up_ace bool;
  hand_id uuid := gen_random_uuid();
  hands_arr jsonb;
  st text;
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

  if dealer_up_ace then
    st := 'awaiting_insurance';
  else
    st := 'active';
  end if;

  insert into public.blackjack_hands
    (id,user_id,bet,deck,dealer_cards,hands,active_hand,status)
    values (hand_id, uid, p_amount, d, dcards, hands_arr, 0, st);

  if player_bj and not dealer_up_ace then
    perform public._bj_finalize(hand_id);
  end if;

  return query select * from public.blackjack_hands where id = hand_id;
end; $$;
grant execute on function public.bj_start(integer) to authenticated;


-- ── play_plinko: remove the 100 000 cap ──────────────────────────────────────
create or replace function public.play_plinko(
  p_bet  integer,
  p_rows integer default 8,
  p_risk text    default 'medium'
) returns table (
  new_balance  integer,
  path         boolean[],
  bin_index    int,
  multiplier   numeric,
  payout       integer,
  won          boolean
)
language plpgsql security definer set search_path = public as $$
declare
  uid     uuid := auth.uid();
  prof    public.profiles%rowtype;
  rows_   int  := coalesce(p_rows, 8);
  risk_   text := coalesce(p_risk, 'medium');
  path_   boolean[];
  bin     int;
  mult    numeric;
  pay     integer;
  did_win boolean;
  bal     integer;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not public.is_game_active('plinko') then
    raise exception 'Plinko is currently out of rotation';
  end if;
  if p_bet is null or p_bet < 1 then raise exception 'bet must be >= 1'; end if;
  -- upper cap removed
  if rows_ < 4 or rows_ > 12 then raise exception 'rows must be 4..12'; end if;
  if risk_ not in ('low','medium','high') then raise exception 'risk must be low/medium/high'; end if;

  select * into prof from public.profiles where id = uid for update;
  if prof.credits < p_bet then raise exception 'Not enough credits (need %)', p_bet; end if;

  perform public._apply_credit_delta(uid, -p_bet, 'plinko',
    jsonb_build_object('phase','wager','rows',rows_,'risk',risk_));

  select s.path, s.bin_index, s.multiplier
    into path_, bin, mult
    from public._plinko_spin(rows_, risk_) s;

  pay := floor(p_bet::numeric * mult)::int;
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
grant execute on function public.play_plinko(integer, integer, text) to authenticated;


-- ============================================================================
-- Done.
-- ============================================================================
