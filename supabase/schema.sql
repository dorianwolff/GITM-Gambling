-- ============================================================================
-- GITM Gambling — Supabase schema
-- Run in: Supabase Dashboard → SQL editor → New query → paste & run.
-- Re-runnable (idempotent where possible).
--
-- SECURITY MODEL
--   * Tables are protected by Row Level Security.
--   * Credits column is *never* writable from the client (RLS denies UPDATE).
--   * All credit mutations go through SECURITY DEFINER functions which
--     validate balance, apply atomic updates and write a transactions row.
--   * `auth_email_domain_check()` runs on profile create and rejects any
--     email outside the configured allow-list (defense in depth on top of
--     the Azure single-tenant restriction).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Extensions & app config
-- ----------------------------------------------------------------------------
create extension if not exists pgcrypto;

-- Edit this allow-list to match your school domain(s).
create or replace function public.allowed_email_domains()
returns text[] language sql immutable as $$
  select array['epita.fr']::text[];
$$;

-- ----------------------------------------------------------------------------
-- 1. profiles
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  email           text not null unique,
  display_name    text not null,
  avatar_url      text,
  credits         integer not null default 200 check (credits >= 0),
  is_admin        boolean not null default false,
  streak_days     integer not null default 0,
  last_claim_date date,
  total_wagered   bigint not null default 0,
  total_won       bigint not null default 0,
  created_at      timestamptz not null default now()
);

create index if not exists profiles_credits_idx on public.profiles (credits desc);

alter table public.profiles enable row level security;

drop policy if exists "profiles read all" on public.profiles;
create policy "profiles read all" on public.profiles
  for select using (true);

drop policy if exists "profiles update self limited" on public.profiles;
-- Users may update only their own non-sensitive columns (display_name, avatar_url).
-- Note: WITH CHECK ensures the protected columns aren't changed.
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
  );

-- ----------------------------------------------------------------------------
-- 2. transactions (immutable ledger)
-- ----------------------------------------------------------------------------
create table if not exists public.transactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  delta       integer not null,
  balance_after integer not null,
  kind        text not null check (kind in (
    'daily_claim','signup_bonus',
    'bet_place','bet_payout',
    'game_coinflip','game_dice','game_roulette','game_blackjack','game_crash',
    'emoji_hunt','admin_grant','admin_revoke'
  )),
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists transactions_user_idx on public.transactions (user_id, created_at desc);

alter table public.transactions enable row level security;

drop policy if exists "transactions read own" on public.transactions;
create policy "transactions read own" on public.transactions
  for select using (auth.uid() = user_id);

-- No insert/update/delete policies → only SECURITY DEFINER functions can write.

-- ----------------------------------------------------------------------------
-- 3. events (user-created bets)
-- ----------------------------------------------------------------------------
create table if not exists public.events (
  id            uuid primary key default gen_random_uuid(),
  creator_id    uuid not null references public.profiles(id) on delete cascade,
  title         text not null check (char_length(title) between 6 and 120),
  description   text not null default '' check (char_length(description) <= 1000),
  options       text[] not null check (array_length(options,1) between 2 and 8),
  closes_at     timestamptz not null,
  resolved_at   timestamptz,
  winning_option int,                      -- index into options[]
  cancelled     boolean not null default false,
  created_at    timestamptz not null default now()
);

create index if not exists events_open_idx on public.events (closes_at desc) where resolved_at is null and not cancelled;

alter table public.events enable row level security;

drop policy if exists "events read all" on public.events;
create policy "events read all" on public.events for select using (true);
-- Inserts and resolution go through RPCs.

-- ----------------------------------------------------------------------------
-- 4. event_bets
-- ----------------------------------------------------------------------------
create table if not exists public.event_bets (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  option_idx  int not null,
  amount      integer not null check (amount > 0),
  payout      integer,                     -- set on resolve
  created_at  timestamptz not null default now()
);

create index if not exists event_bets_event_idx on public.event_bets (event_id);
create index if not exists event_bets_user_idx  on public.event_bets (user_id, created_at desc);

alter table public.event_bets enable row level security;

drop policy if exists "event bets read all" on public.event_bets;
create policy "event bets read all" on public.event_bets for select using (true);

-- ----------------------------------------------------------------------------
-- 5. emoji_hunts (realtime hidden-emoji race)
-- ----------------------------------------------------------------------------
create table if not exists public.emoji_hunts (
  id          uuid primary key default gen_random_uuid(),
  emoji       text not null,
  reward      integer not null default 25,
  position_x  real not null,                -- 0..1, % of viewport width
  position_y  real not null,
  expires_at  timestamptz not null,
  found_by    uuid references public.profiles(id),
  found_at    timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists emoji_hunts_active_idx on public.emoji_hunts (expires_at) where found_by is null;

alter table public.emoji_hunts enable row level security;
drop policy if exists "emoji hunts read all" on public.emoji_hunts;
create policy "emoji hunts read all" on public.emoji_hunts for select using (true);

-- ============================================================================
-- 6. Auth trigger — create profile + enforce email domain
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  domain text;
  allowed text[];
begin
  domain := lower(split_part(coalesce(new.email,''), '@', 2));
  allowed := public.allowed_email_domains();

  if domain is null or domain = '' or not (domain = any(allowed)) then
    raise exception 'Email domain % is not allowed', domain;
  end if;

  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name',
             new.raw_user_meta_data->>'full_name',
             split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;

  insert into public.transactions (user_id, delta, balance_after, kind, meta)
  values (new.id, 200, 200, 'signup_bonus', '{}'::jsonb);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- 7. Helper — atomic credit mutation. Internal only.
-- ============================================================================
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

-- ============================================================================
-- 8. claim_daily_credits()
-- ============================================================================
create or replace function public.claim_daily_credits()
returns table(new_balance integer, streak integer, awarded integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  prof public.profiles%rowtype;
  today date := (now() at time zone 'utc')::date;
  base_amount integer := 100;
  bonus integer;
  award integer;
  next_streak integer;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  select * into prof from public.profiles where id = uid for update;
  if not found then raise exception 'Profile not found'; end if;

  if prof.last_claim_date = today then
    raise exception 'Already claimed today';
  end if;

  if prof.last_claim_date = today - 1 then
    next_streak := prof.streak_days + 1;
  else
    next_streak := 1;
  end if;

  bonus := least(next_streak * 10, 100);
  award := base_amount + bonus;

  perform public._apply_credit_delta(uid, award, 'daily_claim',
    jsonb_build_object('streak', next_streak, 'bonus', bonus));

  update public.profiles
     set last_claim_date = today,
         streak_days     = next_streak
   where id = uid;

  return query
    select credits, streak_days, award from public.profiles where id = uid;
end;
$$;

grant execute on function public.claim_daily_credits() to authenticated;

-- ============================================================================
-- 9. Game RPCs — Coinflip / Dice / Roulette / Blackjack / Crash
--    All authoritative randomness lives here.
-- ============================================================================

-- 9.1 coinflip
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
  if p_amount < 1 or p_amount > 10000 then raise exception 'Invalid amount'; end if;

  perform public._apply_credit_delta(uid, -p_amount, 'game_coinflip',
    jsonb_build_object('phase','wager','side',p_side));

  flip := case when (random() < 0.5) then 'heads' else 'tails' end;
  win := flip = p_side;
  if win then
    pay := (p_amount * 195) / 100;  -- 1.95x payout
    perform public._apply_credit_delta(uid, pay, 'game_coinflip',
      jsonb_build_object('phase','win','result',flip));
  else
    perform public._apply_credit_delta(uid, 0, 'game_coinflip',
      jsonb_build_object('phase','loss','result',flip));
  end if;

  return query select p.credits, win, flip, pay from public.profiles p where p.id = uid;
end; $$;
grant execute on function public.play_coinflip(integer,text) to authenticated;

-- 9.2 dice — bet "over" or "under" a target (4..96)
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
  if p_amount < 1 or p_amount > 10000 then raise exception 'Invalid amount'; end if;

  perform public._apply_credit_delta(uid, -p_amount, 'game_dice',
    jsonb_build_object('phase','wager','target',p_target,'over',p_over));

  r := floor(random()*100)::int + 1;  -- 1..100
  if p_over then
    win := r > p_target;
    win_chance := (100 - p_target)::numeric / 100;
  else
    win := r < p_target;
    win_chance := (p_target - 1)::numeric / 100;
  end if;

  -- 97% RTP
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

-- 9.3 roulette — European single-zero. p_bets jsonb: [{type,value,amount}, ...]
--   types: 'number' (0..36), 'red','black','even','odd','low','high','dozen' (1..3), 'column' (1..3)
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

  -- Sum total wager and lock funds first.
  for bet in select * from jsonb_array_elements(p_bets) loop
    amt := (bet->>'amount')::int;
    if amt is null or amt < 1 then raise exception 'Invalid bet amount'; end if;
    total_w := total_w + amt;
  end loop;
  if total_w > 10000 then raise exception 'Total wager too large'; end if;

  perform public._apply_credit_delta(uid, -total_w, 'game_roulette',
    jsonb_build_object('phase','wager','bets',p_bets));

  -- Spin
  r := floor(random()*37)::int;  -- 0..36
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

-- 9.4 blackjack — single-shot resolved server-side.
--    For simplicity, the server plays both hands deterministically and returns
--    the full hand history. (Hit/stand decision is client-driven by repeated
--    calls — but to keep it simple and tamper-proof we resolve one shot
--    "auto play to 17 or above" if p_strategy = 'auto'.)
--
--    For a fully interactive flow you'd model bj_session rows; we expose a
--    "blackjack_quick" round which uses the optimal-ish strategy chosen by
--    the player up-front. Here we ship a simple "stand_at" parameter.
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
  if p_amount < 1 or p_amount > 10000 then raise exception 'Invalid amount'; end if;
  if p_stand_at < 12 or p_stand_at > 21 then raise exception 'stand_at must be 12..21'; end if;

  perform public._apply_credit_delta(uid, -p_amount, 'game_blackjack',
    jsonb_build_object('phase','wager','stand_at',p_stand_at));

  -- Build & shuffle a single deck (values 1..10, where 10 covers J/Q/K).
  with raw as (
    select case when ((g-1) % 13)+1 > 10 then 10 else ((g-1) % 13)+1 end as v
      from generate_series(1,52) g
  )
  select array_agg(v order by random()) into deck from raw;

  ph := array[deck[1], deck[3]];
  dh := array[deck[2], deck[4]];
  di := 5; -- next card index

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

-- helper: blackjack total with soft-ace handling
create or replace function public.bj_total(hand int[])
returns int language plpgsql immutable as $$
declare s int := 0; aces int := 0; v int;
begin
  foreach v in array hand loop
    if v = 1 then aces := aces + 1; s := s + 11;
    else s := s + v;
    end if;
  end loop;
  while s > 21 and aces > 0 loop
    s := s - 10; aces := aces - 1;
  end loop;
  return s;
end; $$;

grant execute on function public.play_blackjack(integer,integer) to authenticated;
grant execute on function public.bj_total(int[]) to authenticated;

-- 9.5 crash — provably-fair-ish: server picks crash point, player picks cashout.
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
  if p_amount < 1 or p_amount > 10000 then raise exception 'Invalid amount'; end if;
  if p_cashout < 1.01 or p_cashout > 100 then raise exception 'Cashout out of range'; end if;

  perform public._apply_credit_delta(uid, -p_amount, 'game_crash',
    jsonb_build_object('phase','wager','cashout',p_cashout));

  -- 4% house edge "instabust" then exponential.
  rnd := random();
  if rnd < 0.04 then
    cp := 1.00;
  else
    -- crash point distribution with ~96% RTP at any cashout target:
    --   E[max(min(X, c), 1)] / 1 ≈ 0.96
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

-- ============================================================================
-- 10. Events RPCs
-- ============================================================================
create or replace function public.create_event(
  p_title text, p_description text, p_options text[], p_closes_at timestamptz)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  prof public.profiles%rowtype;
  today date := (now() at time zone 'utc')::date;
  cnt int;
  new_id uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into prof from public.profiles where id = uid;

  if not prof.is_admin then
    select count(*) into cnt
      from public.events
      where creator_id = uid
        and (created_at at time zone 'utc')::date = today;
    if cnt >= 1 then raise exception 'You can only create 1 event per day'; end if;
  end if;

  if char_length(p_title) < 6 or char_length(p_title) > 120 then raise exception 'Title length invalid'; end if;
  if array_length(p_options,1) < 2 or array_length(p_options,1) > 8 then raise exception 'Options count invalid'; end if;
  if p_closes_at < now() + interval '1 minute' then raise exception 'Close date too soon'; end if;

  insert into public.events (creator_id,title,description,options,closes_at)
  values (uid, p_title, coalesce(p_description,''), p_options, p_closes_at)
  returning id into new_id;

  return new_id;
end; $$;
grant execute on function public.create_event(text,text,text[],timestamptz) to authenticated;

create or replace function public.place_event_bet(p_event uuid, p_option int, p_amount integer)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  ev public.events%rowtype;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_amount < 1 or p_amount > 10000 then raise exception 'Invalid amount'; end if;

  select * into ev from public.events where id = p_event for update;
  if not found then raise exception 'Event not found'; end if;
  if ev.cancelled then raise exception 'Event cancelled'; end if;
  if ev.resolved_at is not null then raise exception 'Event already resolved'; end if;
  if now() >= ev.closes_at then raise exception 'Event closed'; end if;
  if p_option < 0 or p_option >= array_length(ev.options,1) then raise exception 'Invalid option'; end if;

  perform public._apply_credit_delta(uid, -p_amount, 'bet_place',
    jsonb_build_object('event_id',p_event,'option',p_option));

  insert into public.event_bets (event_id,user_id,option_idx,amount)
  values (p_event, uid, p_option, p_amount);

  return (select credits from public.profiles where id = uid);
end; $$;
grant execute on function public.place_event_bet(uuid,int,integer) to authenticated;

-- Resolve an event: distribute pot among winners pro-rata; 5% house fee.
create or replace function public.resolve_event(p_event uuid, p_winning_option int)
returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  ev public.events%rowtype;
  prof public.profiles%rowtype;
  total_pool integer; winning_pool integer; fee integer; net_pool integer;
  bet record;
  payout_amt integer;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into prof from public.profiles where id = uid;
  select * into ev from public.events where id = p_event for update;
  if not found then raise exception 'Event not found'; end if;
  if ev.resolved_at is not null then raise exception 'Already resolved'; end if;

  -- Only creator OR admin can resolve. Creator can only resolve after close.
  if not prof.is_admin and (ev.creator_id <> uid or now() < ev.closes_at) then
    raise exception 'Not allowed to resolve';
  end if;

  if p_winning_option < 0 or p_winning_option >= array_length(ev.options,1) then
    raise exception 'Invalid option';
  end if;

  select coalesce(sum(amount),0) into total_pool from public.event_bets where event_id = p_event;
  select coalesce(sum(amount),0) into winning_pool from public.event_bets
     where event_id = p_event and option_idx = p_winning_option;

  fee := (total_pool * 5) / 100;       -- 5% house
  net_pool := total_pool - fee;

  if winning_pool = 0 then
    -- nobody won; refund everyone their wager
    for bet in select * from public.event_bets where event_id = p_event loop
      perform public._apply_credit_delta(bet.user_id, bet.amount, 'bet_payout',
        jsonb_build_object('event_id',p_event,'refund',true));
      update public.event_bets set payout = bet.amount where id = bet.id;
    end loop;
  else
    for bet in select * from public.event_bets where event_id = p_event and option_idx = p_winning_option loop
      payout_amt := floor((bet.amount::numeric / winning_pool) * net_pool)::int;
      if payout_amt > 0 then
        perform public._apply_credit_delta(bet.user_id, payout_amt, 'bet_payout',
          jsonb_build_object('event_id',p_event,'won',true));
      end if;
      update public.event_bets set payout = payout_amt where id = bet.id;
    end loop;
    update public.event_bets set payout = 0
      where event_id = p_event and option_idx <> p_winning_option;
  end if;

  update public.events
     set resolved_at = now(), winning_option = p_winning_option
   where id = p_event;
end; $$;
grant execute on function public.resolve_event(uuid,int) to authenticated;

-- ============================================================================
-- 11. Emoji-hunt: claim_emoji_hunt(id)
-- ============================================================================
create or replace function public.claim_emoji_hunt(p_id uuid)
returns table(new_balance integer, reward integer)
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  hunt public.emoji_hunts%rowtype;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  select * into hunt from public.emoji_hunts where id = p_id for update;
  if not found then raise exception 'Hunt not found'; end if;
  if hunt.found_by is not null then raise exception 'Already claimed'; end if;
  if now() > hunt.expires_at then raise exception 'Hunt expired'; end if;

  update public.emoji_hunts
     set found_by = uid, found_at = now()
   where id = p_id;

  perform public._apply_credit_delta(uid, hunt.reward, 'emoji_hunt',
    jsonb_build_object('hunt_id', p_id, 'emoji', hunt.emoji));

  return query select p.credits, hunt.reward from public.profiles p where p.id = uid;
end; $$;
grant execute on function public.claim_emoji_hunt(uuid) to authenticated;

-- Admin-only spawn (anyone authed could call but only admins can mutate
-- emoji_hunts table without going through this function).
create or replace function public.spawn_emoji_hunt()
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  prof public.profiles%rowtype;
  pool text[] := array['💎','🪙','🎰','🍀','⭐','🔥','🚀','👑','🦄','🎲'];
  emo text;
  new_id uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into prof from public.profiles where id = uid;
  if not prof.is_admin then raise exception 'Admins only'; end if;
  emo := pool[1 + floor(random()*array_length(pool,1))::int];
  insert into public.emoji_hunts (emoji, reward, position_x, position_y, expires_at)
  values (emo, 25, random(), 0.1 + random()*0.8, now() + interval '30 seconds')
  returning id into new_id;
  return new_id;
end; $$;
grant execute on function public.spawn_emoji_hunt() to authenticated;

-- ============================================================================
-- 12. Realtime publications
-- ============================================================================
-- Enable realtime broadcast on the relevant tables. (You may also flip these
-- on from Dashboard → Database → Publications.)
do $$
begin
  perform 1 from pg_publication where pubname = 'supabase_realtime';
  if found then
    begin alter publication supabase_realtime add table public.events;       exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.event_bets;   exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.emoji_hunts;  exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.profiles;     exception when duplicate_object then null; end;
  end if;
end $$;

-- ============================================================================
-- 13. Leaderboard view
-- ============================================================================
create or replace view public.v_leaderboard as
  select id, display_name, avatar_url, credits, total_wagered, total_won
    from public.profiles
   order by credits desc
   limit 100;

grant select on public.v_leaderboard to authenticated, anon;

-- Done.
