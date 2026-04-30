-- ============================================================================
-- Migration v2 — interactive blackjack + page-locked emoji hunts
--
-- Run this in: Supabase Dashboard → SQL editor → New query → paste & Run.
-- Idempotent: safe to re-run. Replaces the old single-shot play_blackjack
-- and adds page_path / size_px to emoji_hunts.
-- ============================================================================

-- 14.0 Drop old single-shot blackjack (replaced).
drop function if exists public.play_blackjack(integer,integer);
drop function if exists public.bj_total(int[]);

-- 14.1 Card encoding: integers 0..51.
--      rank = (n % 13) + 1   ⇒ 1=Ace, 2..10=pip, 11=J, 12=Q, 13=K
--      suit =  n / 13        ⇒ 0=♠ 1=♣ 2=♥ 3=♦
create or replace function public.bj_hand_total(hand int[])
returns int language plpgsql immutable as $$
declare s int := 0; aces int := 0; c int; r int;
begin
  if hand is null or array_length(hand,1) is null then return 0; end if;
  foreach c in array hand loop
    r := (c % 13) + 1;
    if r = 1 then aces := aces + 1; s := s + 11;
    elsif r >= 10 then s := s + 10;
    else s := s + r;
    end if;
  end loop;
  while s > 21 and aces > 0 loop
    s := s - 10; aces := aces - 1;
  end loop;
  return s;
end; $$;

create or replace function public.bj_card_rank(c int)
returns int language sql immutable as $$ select (c % 13) + 1; $$;

-- 14.2 blackjack_hands table — one row per game session.
create table if not exists public.blackjack_hands (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles(id) on delete cascade,
  bet                 integer not null check (bet > 0),
  deck                integer[] not null,
  dealer_cards        integer[] not null,
  hands               jsonb not null,
  active_hand         integer not null default 0,
  insurance_bet       integer not null default 0,
  insurance_resolved  boolean not null default false,
  status              text not null check (status in ('awaiting_insurance','active','done')),
  outcome_summary     jsonb,
  created_at          timestamptz not null default now(),
  resolved_at         timestamptz
);

create index if not exists bj_hands_user_active_idx
  on public.blackjack_hands (user_id) where status <> 'done';

alter table public.blackjack_hands enable row level security;
drop policy if exists "bj_hands read own" on public.blackjack_hands;
create policy "bj_hands read own" on public.blackjack_hands
  for select using (auth.uid() = user_id);

-- 14.3 _bj_finalize — dealer plays, payouts applied per hand.
create or replace function public._bj_finalize(p_hand_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  h public.blackjack_hands%rowtype;
  dt int; pt int;
  any_alive boolean := false;
  e jsonb;
  arr jsonb := '[]'::jsonb;
  bet_amt int;
  pcards int[];
  payout int;
  result text;
  is_bj bool;
  i int := 0;
  tot_payout int := 0;
begin
  select * into h from public.blackjack_hands where id = p_hand_id for update;
  if not found then return; end if;
  if h.status = 'done' then return; end if;

  for e in select value from jsonb_array_elements(h.hands) loop
    pcards := array(select (jsonb_array_elements_text(e->'cards'))::int);
    if not coalesce((e->>'surrendered')::bool, false)
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
    bet_amt := (e->>'bet')::int;
    pcards  := array(select (jsonb_array_elements_text(e->'cards'))::int);
    pt      := public.bj_hand_total(pcards);
    is_bj   := coalesce((e->>'blackjack')::bool, false);
    payout  := 0;

    if coalesce((e->>'surrendered')::bool, false) then
      result := 'surrender'; payout := bet_amt / 2;
    elsif pt > 21 then
      result := 'bust'; payout := 0;
    elsif is_bj and dt <> 21 then
      result := 'blackjack'; payout := (bet_amt * 5) / 2;
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
      'doubled',     coalesce((e->>'doubled')::bool,false),
      'surrendered', coalesce((e->>'surrendered')::bool,false),
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

-- 14.4 _bj_advance — next hand or finalize.
create or replace function public._bj_advance(p_hand_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  h public.blackjack_hands%rowtype;
  e jsonb; i int := 0; next_idx int := -1;
begin
  select * into h from public.blackjack_hands where id = p_hand_id for update;
  for e in select value from jsonb_array_elements(h.hands) loop
    if i > h.active_hand and not coalesce((e->>'done')::bool,false) then
      next_idx := i; exit;
    end if;
    i := i + 1;
  end loop;
  if next_idx >= 0 then
    update public.blackjack_hands set active_hand = next_idx where id = h.id;
  else
    perform public._bj_finalize(h.id);
  end if;
end; $$;

-- 14.5 bj_start
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
  if p_amount < 1 or p_amount > 10000 then raise exception 'Invalid amount'; end if;

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
    (id,user_id,bet,deck,dealer_cards,hands,active_hand,status)
    values (hand_id, uid, p_amount, d, dcards, hands_arr, 0, st);

  if player_bj and not dealer_up_ace then
    perform public._bj_finalize(hand_id);
  end if;

  return query select * from public.blackjack_hands where id = hand_id;
end; $$;
grant execute on function public.bj_start(integer) to authenticated;

-- 14.6 bj_insurance
create or replace function public.bj_insurance(p_hand_id uuid, p_take boolean)
returns setof public.blackjack_hands
language plpgsql security definer set search_path = public as $$
declare
  h public.blackjack_hands%rowtype;
  ins_amt int; ins_payout int := 0;
  dealer_bj bool;
  hands_arr jsonb := '[]'::jsonb;
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
grant execute on function public.bj_insurance(uuid,boolean) to authenticated;

-- 14.7 bj_hit
create or replace function public.bj_hit(p_hand_id uuid)
returns setof public.blackjack_hands
language plpgsql security definer set search_path = public as $$
declare
  h public.blackjack_hands%rowtype;
  hand jsonb; cards int[]; new_card int; pt int;
  arr jsonb := '[]'::jsonb; i int := 0;
begin
  select * into h from public.blackjack_hands where id = p_hand_id for update;
  if not found or h.user_id <> auth.uid() then raise exception 'Hand not found'; end if;
  if h.status <> 'active' then raise exception 'Hand not active'; end if;

  new_card := h.deck[1];
  for hand in select value from jsonb_array_elements(h.hands) loop
    if i = h.active_hand then
      cards := array(select (jsonb_array_elements_text(hand->'cards'))::int) || new_card;
      pt := public.bj_hand_total(cards);
      hand := jsonb_set(hand, '{cards}', to_jsonb(cards));
      if pt >= 21 then
        hand := jsonb_set(hand, '{done}', 'true'::jsonb);
      end if;
    end if;
    arr := arr || jsonb_build_array(hand);
    i := i + 1;
  end loop;

  update public.blackjack_hands set hands = arr, deck = h.deck[2:] where id = h.id;
  if pt >= 21 then perform public._bj_advance(h.id); end if;
  return query select * from public.blackjack_hands where id = h.id;
end; $$;
grant execute on function public.bj_hit(uuid) to authenticated;

-- 14.8 bj_stand
create or replace function public.bj_stand(p_hand_id uuid)
returns setof public.blackjack_hands
language plpgsql security definer set search_path = public as $$
declare
  h public.blackjack_hands%rowtype;
  arr jsonb := '[]'::jsonb; e jsonb; i int := 0;
begin
  select * into h from public.blackjack_hands where id = p_hand_id for update;
  if not found or h.user_id <> auth.uid() then raise exception 'Hand not found'; end if;
  if h.status <> 'active' then raise exception 'Hand not active'; end if;

  for e in select value from jsonb_array_elements(h.hands) loop
    if i = h.active_hand then e := jsonb_set(e, '{done}', 'true'::jsonb); end if;
    arr := arr || jsonb_build_array(e);
    i := i + 1;
  end loop;
  update public.blackjack_hands set hands = arr where id = h.id;
  perform public._bj_advance(h.id);
  return query select * from public.blackjack_hands where id = h.id;
end; $$;
grant execute on function public.bj_stand(uuid) to authenticated;

-- 14.9 bj_double
create or replace function public.bj_double(p_hand_id uuid)
returns setof public.blackjack_hands
language plpgsql security definer set search_path = public as $$
declare
  h public.blackjack_hands%rowtype;
  hand jsonb; cards int[]; new_card int; bet_amt int; pt int;
  arr jsonb := '[]'::jsonb; e jsonb; i int := 0;
begin
  select * into h from public.blackjack_hands where id = p_hand_id for update;
  if not found or h.user_id <> auth.uid() then raise exception 'Hand not found'; end if;
  if h.status <> 'active' then raise exception 'Hand not active'; end if;

  hand := h.hands -> h.active_hand;
  cards := array(select (jsonb_array_elements_text(hand->'cards'))::int);
  if array_length(cards,1) <> 2 then raise exception 'Can only double on first 2 cards'; end if;
  bet_amt := (hand->>'bet')::int;

  perform public._apply_credit_delta(h.user_id, -bet_amt, 'game_blackjack',
    jsonb_build_object('phase','double','hand',h.active_hand));

  new_card := h.deck[1];
  cards := cards || new_card;
  pt := public.bj_hand_total(cards);

  for e in select value from jsonb_array_elements(h.hands) loop
    if i = h.active_hand then
      e := jsonb_set(e, '{cards}',  to_jsonb(cards));
      e := jsonb_set(e, '{bet}',    to_jsonb(bet_amt * 2));
      e := jsonb_set(e, '{doubled}','true'::jsonb);
      e := jsonb_set(e, '{done}',   'true'::jsonb);
    end if;
    arr := arr || jsonb_build_array(e);
    i := i + 1;
  end loop;

  update public.blackjack_hands set hands = arr, deck = h.deck[2:] where id = h.id;
  perform public._bj_advance(h.id);
  return query select * from public.blackjack_hands where id = h.id;
end; $$;
grant execute on function public.bj_double(uuid) to authenticated;

-- 14.10 bj_split
create or replace function public.bj_split(p_hand_id uuid)
returns setof public.blackjack_hands
language plpgsql security definer set search_path = public as $$
declare
  h public.blackjack_hands%rowtype;
  hand jsonb; cards int[]; r1 int; r2 int; bet_amt int;
  c1 int; c2 int; nc1 int; nc2 int;
  is_aces bool;
  hand1 jsonb; hand2 jsonb;
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

  bet_amt := (hand->>'bet')::int;
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
     set hands       = jsonb_build_array(hand1, hand2),
         deck        = h.deck[3:],
         active_hand = 0
   where id = h.id;

  if (hand1->>'done')::bool then perform public._bj_advance(h.id); end if;
  return query select * from public.blackjack_hands where id = h.id;
end; $$;
grant execute on function public.bj_split(uuid) to authenticated;

-- 14.11 bj_surrender
create or replace function public.bj_surrender(p_hand_id uuid)
returns setof public.blackjack_hands
language plpgsql security definer set search_path = public as $$
declare
  h public.blackjack_hands%rowtype;
  hand jsonb; cards int[];
  arr jsonb := '[]'::jsonb; e jsonb; i int := 0;
begin
  select * into h from public.blackjack_hands where id = p_hand_id for update;
  if not found or h.user_id <> auth.uid() then raise exception 'Hand not found'; end if;
  if h.status <> 'active' then raise exception 'Hand not active'; end if;
  if jsonb_array_length(h.hands) <> 1 then raise exception 'Cannot surrender after split'; end if;

  hand := h.hands -> 0;
  cards := array(select (jsonb_array_elements_text(hand->'cards'))::int);
  if array_length(cards,1) <> 2 then raise exception 'Can only surrender on first 2 cards'; end if;

  for e in select value from jsonb_array_elements(h.hands) loop
    if i = 0 then
      e := jsonb_set(e, '{surrendered}', 'true'::jsonb);
      e := jsonb_set(e, '{done}',        'true'::jsonb);
    end if;
    arr := arr || jsonb_build_array(e);
    i := i + 1;
  end loop;

  update public.blackjack_hands set hands = arr where id = h.id;
  perform public._bj_finalize(h.id);
  return query select * from public.blackjack_hands where id = h.id;
end; $$;
grant execute on function public.bj_surrender(uuid) to authenticated;

-- ============================================================================
-- 15. emoji_hunts v2 — page-locked, variable size
-- ============================================================================
alter table public.emoji_hunts add column if not exists page_path text;
alter table public.emoji_hunts add column if not exists size_px integer not null default 56;

drop function if exists public.spawn_emoji_hunt();

create or replace function public.spawn_emoji_hunt(
  p_page text default null,
  p_size_px integer default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  prof public.profiles%rowtype;
  pool text[] := array['💎','🪙','🎰','🍀','⭐','🔥','🚀','👑','🦄','🎲','🌟','💰','🎯','🎁'];
  routes text[] := array[
    '/dashboard','/events','/leaderboard','/history',
    '/games','/games/coinflip','/games/dice','/games/roulette',
    '/games/blackjack','/games/crash','/games/emoji-hunt'
  ];
  emo text;
  page text;
  sz int;
  new_id uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into prof from public.profiles where id = uid;
  if not prof.is_admin then raise exception 'Admins only'; end if;

  emo  := pool[1 + floor(random()*array_length(pool,1))::int];
  page := coalesce(p_page, routes[1 + floor(random()*array_length(routes,1))::int]);
  sz   := greatest(32, least(128, coalesce(p_size_px, 36 + floor(random()*64)::int)));

  insert into public.emoji_hunts
    (emoji, reward, position_x, position_y, expires_at, page_path, size_px)
  values
    (emo, 25, random(), 0.1 + random()*0.8, now() + interval '45 seconds', page, sz)
  returning id into new_id;
  return new_id;
end; $$;
grant execute on function public.spawn_emoji_hunt(text,integer) to authenticated;

-- Done.
