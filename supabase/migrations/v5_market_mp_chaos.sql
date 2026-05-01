-- ============================================================================
-- Migration v5 — Multiplayer clean-up, Chaos TTT events, Market / Auction
--
-- Run after v4. Idempotent where possible; tables use IF NOT EXISTS.
--
-- Major additions:
--   * _mp_finalize              — winner takes the WHOLE pot (no 5% fee)
--   * Chaos TTT                 — per-turn random event system
--                                   (block / remove_own / remove_opp / swap)
--   * market_items              — cosmetics catalogue (shop + case drops)
--   * user_items                — per-user inventory (quantities for dupes)
--   * market_listings           — auctions (always auctions; 1h .. 48h)
--   * market_bids               — bid history (current bid lives on listing)
--   * Market RPCs               — market_buy, market_equip, market_list,
--                                  market_bid, market_cancel, market_settle
--   * market_fee_percent(price) — tiered seller fee (bigger sale = smaller %)
--   * open_case / _batch        — small chance of rolling a cosmetic item too
--   * transactions.kind         — widened for market_* kinds
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 0. Widen transactions.kind.
-- ----------------------------------------------------------------------------
alter table public.transactions drop constraint if exists transactions_kind_check;
alter table public.transactions
  add constraint transactions_kind_check check (kind in (
    'daily_claim','signup_bonus',
    'bet_place','bet_payout',
    'game_coinflip','game_dice','game_roulette','game_blackjack','game_crash',
    'game_case','game_mp','mp_refund',
    'emoji_hunt','admin_grant','admin_revoke',
    -- v5 ↓
    'market_buy','market_list_fee','market_bid_escrow','market_bid_refund',
    'market_sale_payout','market_auction_refund'
  ));


-- ----------------------------------------------------------------------------
-- 1. MP: winner takes 100% of the pot. No house fee.
-- ----------------------------------------------------------------------------
create or replace function public._mp_finalize(p_id uuid, p_winner smallint, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  g public.mp_games%rowtype;
  pot integer;
  win_uid uuid;
  net integer;
begin
  select * into g from public.mp_games where id = p_id for update;
  if not found or g.status <> 'active' then return; end if;

  pot := g.bet * 2;

  if p_winner = -1 then
    -- Draw: refund both players their stake.
    if g.player_x is not null then
      perform public._apply_credit_delta(g.player_x, g.bet, 'mp_refund',
        jsonb_build_object('mp_id', p_id, 'reason','draw'));
    end if;
    if g.player_o is not null then
      perform public._apply_credit_delta(g.player_o, g.bet, 'mp_refund',
        jsonb_build_object('mp_id', p_id, 'reason','draw'));
    end if;
  elsif p_winner = 0 or p_winner = 1 then
    -- Winner takes everything.
    net := pot;
    win_uid := case when p_winner = 0 then g.player_x else g.player_o end;
    if win_uid is not null then
      perform public._apply_credit_delta(win_uid, net, 'game_mp',
        jsonb_build_object('mp_id', p_id, 'reason', p_reason, 'pot', pot));
    end if;
  end if;

  update public.mp_games
     set status = 'finished',
         winner = p_winner,
         ended_at = now(),
         result_reason = p_reason
   where id = p_id;
end; $$;


-- ----------------------------------------------------------------------------
-- 2. Chaos TTT — per-turn random event system.
--
-- Event shapes (stored in state.event):
--   { type:'nothing' }
--   { type:'block',      cell:int }                    — that cell locked this turn
--   { type:'remove_own', cell:int }                    — piece removed (already applied)
--   { type:'remove_opp', cell:int }                    — piece removed (already applied)
--   { type:'swap',       own:int, opp:int }            — swap performed (already applied)
--
-- Events are rolled at the START of each player's turn. Applicable pool is
-- computed based on the board; "nothing" is the last-resort fallback.
-- ----------------------------------------------------------------------------

create or replace function public._mp_chaos_roll_event(
  p_board int[],       -- 9-element int array, 0=empty, 1=X, 2=O
  p_next_seat smallint -- 0 (X) or 1 (O) — whose turn is starting
) returns jsonb
language plpgsql volatile as $$
declare
  own_marker int := case when p_next_seat = 0 then 1 else 2 end;
  opp_marker int := case when p_next_seat = 0 then 2 else 1 end;
  empties int[];
  own_cells int[];
  opp_cells int[];
  pool text[] := array[]::text[];
  pick text;
  chosen int;
  chosen2 int;
  board int[] := p_board;
begin
  select array_agg(i - 1) into empties
    from generate_series(1,9) i where board[i] = 0;
  select array_agg(i - 1) into own_cells
    from generate_series(1,9) i where board[i] = own_marker;
  select array_agg(i - 1) into opp_cells
    from generate_series(1,9) i where board[i] = opp_marker;

  -- Block: need at least 2 empty cells (can't block if only one left).
  if empties is not null and array_length(empties,1) >= 2 then
    pool := pool || 'block';
  end if;
  -- Remove own: need at least one own piece.
  if own_cells is not null and array_length(own_cells,1) >= 1 then
    pool := pool || 'remove_own';
  end if;
  -- Remove opp: need at least one opp piece.
  if opp_cells is not null and array_length(opp_cells,1) >= 1 then
    pool := pool || 'remove_opp';
  end if;
  -- Swap: need at least one of each.
  if own_cells is not null and opp_cells is not null
     and array_length(own_cells,1) >= 1 and array_length(opp_cells,1) >= 1 then
    pool := pool || 'swap';
  end if;

  if array_length(pool,1) is null then
    return jsonb_build_object('type','nothing','board',to_jsonb(board));
  end if;

  pick := pool[1 + floor(random() * array_length(pool,1))::int];

  if pick = 'block' then
    chosen := empties[1 + floor(random() * array_length(empties,1))::int];
    return jsonb_build_object('type','block','cell',chosen,'board',to_jsonb(board));
  elsif pick = 'remove_own' then
    chosen := own_cells[1 + floor(random() * array_length(own_cells,1))::int];
    board[chosen + 1] := 0;
    return jsonb_build_object('type','remove_own','cell',chosen,'board',to_jsonb(board));
  elsif pick = 'remove_opp' then
    chosen := opp_cells[1 + floor(random() * array_length(opp_cells,1))::int];
    board[chosen + 1] := 0;
    return jsonb_build_object('type','remove_opp','cell',chosen,'board',to_jsonb(board));
  else -- swap
    chosen  := own_cells[1 + floor(random() * array_length(own_cells,1))::int];
    chosen2 := opp_cells[1 + floor(random() * array_length(opp_cells,1))::int];
    board[chosen  + 1] := opp_marker;
    board[chosen2 + 1] := own_marker;
    return jsonb_build_object('type','swap','own',chosen,'opp',chosen2,'board',to_jsonb(board));
  end if;
end; $$;


-- Patch mp_make_move: after a successful non-winning move, roll an event
-- for the OPPONENT'S upcoming turn. Apply board mutation + stash the event
-- and the (possibly new) locked cell into state so the UI can display it.
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
  empties int[];
  faded_cell int;
  mover text;
  filled boolean;
  new_state jsonb;
  ev jsonb;
  next_seat smallint;
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
  board := array(select (jsonb_array_elements_text(g.state->'board'))::int);
  if board[cell + 1] <> 0 then raise exception 'Cell not empty'; end if;

  if g.game_type = 'ttt_chaos' then
    locked := (g.state->>'locked')::int;
    if locked is not null and locked = cell then
      raise exception 'Cell is locked this turn';
    end if;

    board[cell + 1] := marker;

    -- Evaluate winner on the move alone before the next turn's event,
    -- so the win pays out cleanly with no surprise piece removals.
    w := public._mp_ttt_winner(board);

    if w is null then
      next_seat := (1 - seat)::smallint;
      ev := public._mp_chaos_roll_event(board, next_seat);
      board := array(select (jsonb_array_elements_text(ev->'board'))::int);

      -- Recompute winner after the event (the event may open a winning line;
      -- if so, award the player whose symbol now forms the line).
      w := public._mp_ttt_winner(board);

      new_state := jsonb_build_object(
        'board',  to_jsonb(board),
        'locked', case
                    when ev->>'type' = 'block' then ev->'cell'
                    else 'null'::jsonb
                  end,
        'event',  ev - 'board'  -- strip the board copy from the event payload
      );
    else
      -- Winning move — no next event, no locked cell.
      new_state := jsonb_build_object(
        'board', to_jsonb(board),
        'locked','null'::jsonb,
        'event', jsonb_build_object('type','nothing')
      );
    end if;

  elsif g.game_type = 'ttt_fade' then
    x_moves := array(select (jsonb_array_elements_text(g.state->'x_moves'))::int);
    o_moves := array(select (jsonb_array_elements_text(g.state->'o_moves'))::int);

    board[cell + 1] := marker;
    if mover = 'x' then
      x_moves := x_moves || cell;
      if array_length(x_moves,1) > 3 then
        faded_cell := x_moves[1]; x_moves := x_moves[2:];
        if board[faded_cell + 1] = 1 then board[faded_cell + 1] := 0; end if;
      end if;
    else
      o_moves := o_moves || cell;
      if array_length(o_moves,1) > 3 then
        faded_cell := o_moves[1]; o_moves := o_moves[2:];
        if board[faded_cell + 1] = 2 then board[faded_cell + 1] := 0; end if;
      end if;
    end if;

    w := public._mp_ttt_winner(board);
    new_state := jsonb_build_object(
      'board',   to_jsonb(board),
      'x_moves', to_jsonb(x_moves),
      'o_moves', to_jsonb(o_moves),
      'faded',   to_jsonb(faded_cell)
    );
  else
    raise exception 'Unknown game type';
  end if;

  update public.mp_games
     set state     = new_state,
         turn      = case when w is null then (1 - g.turn)::smallint else g.turn end,
         last_move = jsonb_build_object('seat', seat, 'cell', cell, 'at', now())
   where id = p_id;

  if w is not null then
    perform public._mp_finalize(p_id, w, 'three-in-a-row');
  else
    if g.game_type = 'ttt_chaos' then
      filled := not exists (select 1 from generate_series(1,9) i where board[i] = 0);
      if filled then
        perform public._mp_finalize(p_id, -1::smallint, 'board-full');
      end if;
    end if;
  end if;

  return query select * from public.mp_games where id = p_id;
end; $$;


-- Patch mp_join_game to roll the opening event on game start for chaos mode.
-- We intercept by patching the final 'active' transition. The existing
-- mp_join_game sets status='active' when the second player joins; we hook
-- an after-trigger that fires once on that transition.
drop trigger if exists mp_chaos_opening_event on public.mp_games;
create or replace function public._mp_chaos_opening_event_trg()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  board int[];
  ev jsonb;
begin
  if NEW.game_type = 'ttt_chaos'
     and NEW.status = 'active'
     and (OLD.status is null or OLD.status <> 'active') then
    board := array(select (jsonb_array_elements_text(NEW.state->'board'))::int);
    ev := public._mp_chaos_roll_event(board, 0::smallint);  -- X moves first
    board := array(select (jsonb_array_elements_text(ev->'board'))::int);
    NEW.state := jsonb_build_object(
      'board',  to_jsonb(board),
      'locked', case when ev->>'type' = 'block' then ev->'cell' else 'null'::jsonb end,
      'event',  ev - 'board'
    );
  end if;
  return NEW;
end; $$;

create trigger mp_chaos_opening_event
  before update on public.mp_games
  for each row execute function public._mp_chaos_opening_event_trg();


-- ============================================================================
-- 3. Market / Auction system
-- ============================================================================

-- ---------- Items catalogue --------------------------------------------------
create table if not exists public.market_items (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,
  name         text not null,
  description  text,
  category     text not null,                           -- badge | frame | effect | title
  rarity       text not null,                           -- common..ultra (case rarities)
  shop_price   integer,                                 -- null = not purchasable via shop
  source       text not null default 'shop',            -- shop | case_drop | event_reward
  image_url    text,                                    -- nullable; supply later
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  check (rarity in ('common','uncommon','rare','epic','legendary','jackpot','ultra')),
  check (category in ('badge','frame','effect','title','trophy')),
  check (source in ('shop','case_drop','event_reward','admin'))
);
alter table public.market_items enable row level security;
drop policy if exists "market_items read all" on public.market_items;
create policy "market_items read all" on public.market_items
  for select using (true);

-- ---------- User inventory --------------------------------------------------
create table if not exists public.user_items (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  item_id      uuid not null references public.market_items(id) on delete cascade,
  qty          integer not null default 1 check (qty >= 0),
  equipped     boolean not null default false,
  first_acquired_at timestamptz not null default now(),
  unique (user_id, item_id)
);
alter table public.user_items enable row level security;

drop policy if exists "user_items read all" on public.user_items;
create policy "user_items read all" on public.user_items
  for select using (true);   -- public inventory, anyone can view

-- Only the server ever writes; clients go through SECURITY DEFINER RPCs.
drop policy if exists "user_items service write" on public.user_items;

create index if not exists user_items_user_id_idx on public.user_items(user_id);

-- ---------- Listings --------------------------------------------------------
create table if not exists public.market_listings (
  id               uuid primary key default gen_random_uuid(),
  seller_id        uuid not null references public.profiles(id) on delete cascade,
  item_id          uuid not null references public.market_items(id) on delete cascade,
  start_price      integer not null check (start_price >= 1),
  current_bid      integer,
  current_bidder_id uuid references public.profiles(id),
  bid_count        integer not null default 0,
  ends_at          timestamptz not null,
  created_at       timestamptz not null default now(),
  status           text not null default 'active',
  winner_id        uuid references public.profiles(id),
  final_price      integer,
  fee_paid         integer,
  check (status in ('active','sold','expired','cancelled')),
  check (ends_at > created_at)
);
alter table public.market_listings enable row level security;
drop policy if exists "market_listings read all" on public.market_listings;
create policy "market_listings read all" on public.market_listings for select using (true);

create index if not exists market_listings_status_ends on public.market_listings(status, ends_at);
create index if not exists market_listings_seller on public.market_listings(seller_id);

-- ---------- Bids (history) --------------------------------------------------
create table if not exists public.market_bids (
  id          uuid primary key default gen_random_uuid(),
  listing_id  uuid not null references public.market_listings(id) on delete cascade,
  bidder_id   uuid not null references public.profiles(id) on delete cascade,
  amount      integer not null check (amount >= 1),
  created_at  timestamptz not null default now()
);
alter table public.market_bids enable row level security;
drop policy if exists "market_bids read all" on public.market_bids;
create policy "market_bids read all" on public.market_bids for select using (true);

create index if not exists market_bids_listing on public.market_bids(listing_id, created_at desc);

-- Enable realtime for live auctions.
do $$ begin
  perform 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname='public' and tablename='market_listings';
  if not found then
    execute 'alter publication supabase_realtime add table public.market_listings';
  end if;
exception when others then null;
end $$;
do $$ begin
  perform 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname='public' and tablename='market_bids';
  if not found then
    execute 'alter publication supabase_realtime add table public.market_bids';
  end if;
exception when others then null;
end $$;


-- ---------- Fee schedule ----------------------------------------------------
-- Tiered seller fee — modelled on real auction-house buyer's-premium curves
-- (Sotheby's / Christie's etc.) where the percentage decreases as the
-- price rises. Reverse-skewed so low-value sales fund the system.
create or replace function public.market_fee_percent(price integer)
returns numeric language sql immutable as $$
  select case
    when price <   100 then 12.0   -- under 100 cr
    when price <  1000 then 8.0    -- 100 .. 999
    when price < 10000 then 5.0    -- 1 000 .. 9 999
    when price < 50000 then 3.5    -- 10 000 .. 49 999
    else                    2.0    -- 50 000+
  end::numeric;
$$;

create or replace function public._market_fee(price integer)
returns integer language sql immutable as $$
  select floor(price * public.market_fee_percent(price) / 100.0)::int;
$$;


-- ---------- RPCs ------------------------------------------------------------

-- Buy from shop.
create or replace function public.market_buy(p_item uuid)
returns setof public.user_items
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  it  public.market_items%rowtype;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into it from public.market_items where id = p_item;
  if not found then raise exception 'Item not found'; end if;
  if it.shop_price is null then raise exception 'This item is not sold in the shop'; end if;
  if it.source <> 'shop' then raise exception 'Not a shop item'; end if;

  perform public._apply_credit_delta(uid, -it.shop_price, 'market_buy',
    jsonb_build_object('item_id', p_item, 'slug', it.slug, 'price', it.shop_price));

  insert into public.user_items (user_id, item_id, qty)
    values (uid, p_item, 1)
    on conflict (user_id, item_id) do update
      set qty = user_items.qty + 1;

  return query select * from public.user_items where user_id = uid and item_id = p_item;
end; $$;
grant execute on function public.market_buy(uuid) to authenticated;

-- Equip / unequip a cosmetic the user owns.
create or replace function public.market_equip(p_item uuid, p_equipped boolean)
returns setof public.user_items
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  cat text;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select category into cat from public.market_items where id = p_item;
  if cat is null then raise exception 'Item not found'; end if;

  if p_equipped then
    -- At most one equipped per (user, category).
    update public.user_items u
       set equipped = false
     where u.user_id = uid
       and u.item_id <> p_item
       and u.item_id in (select id from public.market_items where category = cat);
  end if;

  update public.user_items
     set equipped = p_equipped
   where user_id = uid and item_id = p_item;

  return query select * from public.user_items where user_id = uid and item_id = p_item;
end; $$;
grant execute on function public.market_equip(uuid, boolean) to authenticated;

-- List one copy of an owned item for auction.
create or replace function public.market_list(
  p_item uuid, p_start_price integer, p_duration_hours integer
) returns setof public.market_listings
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  u public.user_items%rowtype;
  li public.market_listings;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_start_price < 1 then raise exception 'Start price too low'; end if;
  if p_start_price > 1000000 then raise exception 'Start price too high'; end if;
  if p_duration_hours < 1 or p_duration_hours > 48 then
    raise exception 'Auction duration must be between 1 and 48 hours';
  end if;

  select * into u from public.user_items
    where user_id = uid and item_id = p_item for update;
  if not found or u.qty < 1 then raise exception 'You do not own this item'; end if;

  -- Escrow the item: decrement qty. It is held by the listing until sold or cancelled.
  update public.user_items set qty = qty - 1 where id = u.id;
  -- If this drop the equipped copy and qty is now 0, unequip for clarity.
  if u.qty - 1 = 0 then
    update public.user_items set equipped = false where id = u.id;
  end if;

  insert into public.market_listings
    (seller_id, item_id, start_price, ends_at)
    values (uid, p_item, p_start_price, now() + make_interval(hours => p_duration_hours))
  returning * into li;

  return next li;
end; $$;
grant execute on function public.market_list(uuid, integer, integer) to authenticated;

-- Place a bid. Escrows the funds from the bidder and refunds the previous bidder.
create or replace function public.market_bid(p_listing uuid, p_amount integer)
returns setof public.market_listings
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  li public.market_listings%rowtype;
  min_required integer;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into li from public.market_listings where id = p_listing for update;
  if not found then raise exception 'Listing not found'; end if;
  if li.status <> 'active' then raise exception 'Auction is not active'; end if;
  if now() >= li.ends_at then raise exception 'Auction already ended'; end if;
  if li.seller_id = uid then raise exception 'Cannot bid on your own auction'; end if;

  -- Minimum bid: current_bid + 1, or start_price if no bids yet.
  min_required := coalesce(li.current_bid + 1, li.start_price);
  if p_amount < min_required then
    raise exception 'Bid must be at least %', min_required;
  end if;

  -- Escrow funds from the bidder.
  perform public._apply_credit_delta(uid, -p_amount, 'market_bid_escrow',
    jsonb_build_object('listing_id', p_listing, 'amount', p_amount));

  -- Refund the previous bidder, if any (and not the same user re-bidding higher).
  if li.current_bidder_id is not null and li.current_bidder_id <> uid then
    perform public._apply_credit_delta(li.current_bidder_id, li.current_bid,
      'market_bid_refund',
      jsonb_build_object('listing_id', p_listing, 'amount', li.current_bid));
  elsif li.current_bidder_id = uid then
    -- Same user raising their own bid: refund the previous escrow.
    perform public._apply_credit_delta(uid, li.current_bid,
      'market_bid_refund',
      jsonb_build_object('listing_id', p_listing, 'amount', li.current_bid,'self_raise',true));
  end if;

  update public.market_listings
     set current_bid = p_amount,
         current_bidder_id = uid,
         bid_count = bid_count + 1,
         -- Anti-sniping: if bid placed in the final 2 minutes, extend by 2 min.
         ends_at = case
           when ends_at - now() < interval '2 minutes' then now() + interval '2 minutes'
           else ends_at
         end
   where id = p_listing;

  insert into public.market_bids (listing_id, bidder_id, amount)
    values (p_listing, uid, p_amount);

  return query select * from public.market_listings where id = p_listing;
end; $$;
grant execute on function public.market_bid(uuid, integer) to authenticated;

-- Cancel a listing. Only seller, only if no bids have been placed.
create or replace function public.market_cancel(p_listing uuid)
returns setof public.market_listings
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  li public.market_listings%rowtype;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into li from public.market_listings where id = p_listing for update;
  if not found then raise exception 'Listing not found'; end if;
  if li.seller_id <> uid then raise exception 'Not your listing'; end if;
  if li.status <> 'active' then raise exception 'Listing is not active'; end if;
  if li.bid_count > 0 then raise exception 'Cannot cancel an auction that has bids'; end if;

  -- Return the escrowed item to the seller.
  insert into public.user_items (user_id, item_id, qty)
    values (uid, li.item_id, 1)
    on conflict (user_id, item_id) do update
      set qty = user_items.qty + 1;

  update public.market_listings set status = 'cancelled' where id = p_listing;
  return query select * from public.market_listings where id = p_listing;
end; $$;
grant execute on function public.market_cancel(uuid) to authenticated;

-- Settle a listing after its end time. Callable by anyone — no-ops if
-- already settled or still active. The client triggers this on
-- expiration or via a daily job.
create or replace function public.market_settle(p_listing uuid)
returns setof public.market_listings
language plpgsql security definer set search_path = public as $$
declare
  li public.market_listings%rowtype;
  fee integer;
  net integer;
begin
  select * into li from public.market_listings where id = p_listing for update;
  if not found then raise exception 'Listing not found'; end if;
  if li.status <> 'active' then
    return query select * from public.market_listings where id = p_listing;
    return;
  end if;
  if now() < li.ends_at then raise exception 'Auction has not ended yet'; end if;

  if li.current_bidder_id is null then
    -- No bids — return the item to the seller.
    insert into public.user_items (user_id, item_id, qty)
      values (li.seller_id, li.item_id, 1)
      on conflict (user_id, item_id) do update
        set qty = user_items.qty + 1;
    update public.market_listings
       set status='expired'
     where id = p_listing;
  else
    fee := public._market_fee(li.current_bid);
    net := li.current_bid - fee;

    -- Pay the seller (net of fee). Fee just evaporates into the house.
    perform public._apply_credit_delta(li.seller_id, net, 'market_sale_payout',
      jsonb_build_object('listing_id', p_listing, 'gross', li.current_bid, 'fee', fee));

    -- Deliver the item to the winner.
    insert into public.user_items (user_id, item_id, qty)
      values (li.current_bidder_id, li.item_id, 1)
      on conflict (user_id, item_id) do update
        set qty = user_items.qty + 1;

    update public.market_listings
       set status='sold',
           winner_id = current_bidder_id,
           final_price = current_bid,
           fee_paid = fee
     where id = p_listing;
  end if;

  return query select * from public.market_listings where id = p_listing;
end; $$;
grant execute on function public.market_settle(uuid) to authenticated;


-- ============================================================================
-- 4. Case integration — small chance of dropping a cosmetic item.
--    2% flat chance per open (key opens get 3%). Item rarity tracks the
--    case roll's rarity. If the item pool for that rarity is empty we fall
--    through silently and no item is dropped.
-- ============================================================================

create or replace function public._case_maybe_drop_item(
  p_user uuid, p_rarity text, p_key boolean
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  drop_chance numeric := case when p_key then 0.03 else 0.02 end;
  item_id uuid;
begin
  if random() >= drop_chance then return null; end if;
  -- Pick a random case-drop item matching the rolled rarity.
  select id into item_id
    from public.market_items
   where source = 'case_drop' and rarity = p_rarity
   order by random() limit 1;
  if item_id is null then return null; end if;

  insert into public.user_items (user_id, item_id, qty)
    values (p_user, item_id, 1)
    on conflict (user_id, item_id) do update
      set qty = user_items.qty + 1;
  return item_id;
end; $$;

-- Re-declare open_case with cosmetic drop integrated. We return
-- `dropped_item` as an additional column so the UI can render a toast.
drop function if exists public.open_case(text, boolean);
create or replace function public.open_case(p_tier text, p_key boolean default false)
returns table(
  new_balance integer, tier text, rarity text, reward integer,
  cost integer, pity integer, pity_popped boolean, key_used boolean,
  multiplier numeric, dropped_item uuid
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
  reward_base integer;
  item uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  case p_tier
    when 'bronze' then base_cost := 10;
    when 'silver' then base_cost := 50;
    when 'gold'   then base_cost := 100;
    else raise exception 'Unknown tier %', p_tier;
  end case;
  final_cost := case when p_key then (base_cost * 3) / 2 else base_cost end;

  select case_pity into cur_pity from public.profiles where id = uid for update;
  if cur_pity is null then cur_pity := 0; end if;

  perform public._apply_credit_delta(uid, -final_cost, 'game_case',
    jsonb_build_object('phase','wager','tier',p_tier,'key',p_key));

  r := random();
  rar := public._case_pick_rarity(r);
  if p_key and rar = 'common' then
    r := random();
    rar := public._case_pick_rarity(r);
  end if;

  if not p_key and rar = 'common' and cur_pity >= 9 then
    rar := 'rare';
    pity_hit := true;
  end if;

  mult := public._case_mult(rar);
  reward_base := case when p_key then final_cost else base_cost end;
  rew := floor(reward_base * mult)::int;

  if rew > 0 then
    perform public._apply_credit_delta(uid, rew, 'game_case',
      jsonb_build_object('phase','reward','tier',p_tier,'rarity',rar,
        'key', p_key, 'pity_hit', pity_hit));
  else
    perform public._apply_credit_delta(uid, 0, 'game_case',
      jsonb_build_object('phase','loss','tier',p_tier,'rarity',rar,
        'key', p_key));
  end if;

  if not p_key then
    if rar = 'common' then cur_pity := cur_pity + 1;
    else                    cur_pity := 0;
    end if;
    update public.profiles set case_pity = cur_pity where id = uid;
  end if;

  insert into public.case_openings (user_id, tier, cost, rarity, reward, key_used, pity_popped)
    values (uid, p_tier, final_cost, rar, rew, p_key, pity_hit);

  -- Cosmetic drop chance (non-refunding; bonus on top of credit reward).
  item := public._case_maybe_drop_item(uid, rar, p_key);

  return query
    select p.credits, p_tier, rar, rew, final_cost, cur_pity, pity_hit, p_key, mult, item
      from public.profiles p where p.id = uid;
end; $$;
grant execute on function public.open_case(text, boolean) to authenticated;

-- Patch batch open to also roll item drops per case.
drop function if exists public.open_case_batch(text, boolean, integer);
create or replace function public.open_case_batch(
  p_tier text, p_key boolean, p_count integer
) returns table(
  idx integer, rarity text, reward integer, mult numeric,
  pity_hit boolean, cost integer, dropped_item uuid
)
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  base_cost integer;
  per_cost integer;
  total_cost integer;
  cur_pity integer;
  r numeric;
  rar text;
  m numeric;
  rew integer;
  pit_hit boolean;
  i integer := 0;
  reward_base integer;
  item uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_count not in (3,5,10,20,50) then raise exception 'Batch size must be 3/5/10/20/50'; end if;

  case p_tier
    when 'bronze' then base_cost := 10;
    when 'silver' then base_cost := 50;
    when 'gold'   then base_cost := 100;
    else raise exception 'Unknown tier %', p_tier;
  end case;
  per_cost := case when p_key then (base_cost * 3) / 2 else base_cost end;
  total_cost := per_cost * p_count;

  perform public._apply_credit_delta(uid, -total_cost, 'game_case',
    jsonb_build_object('phase','wager','tier',p_tier,'key',p_key,
      'batch_count', p_count, 'per_cost', per_cost));

  select case_pity into cur_pity from public.profiles where id = uid for update;
  if cur_pity is null then cur_pity := 0; end if;
  reward_base := case when p_key then per_cost else base_cost end;

  while i < p_count loop
    r := random();
    rar := public._case_pick_rarity(r);
    if p_key and rar = 'common' then r := random(); rar := public._case_pick_rarity(r); end if;
    pit_hit := false;
    if not p_key and rar = 'common' and cur_pity >= 9 then
      rar := 'rare'; pit_hit := true;
    end if;

    m := public._case_mult(rar);
    rew := floor(reward_base * m)::int;

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
grant execute on function public.open_case_batch(text,boolean,integer) to authenticated;


-- ============================================================================
-- 5. Seed cosmetics.
--    All cosmetics live in market_items. source='shop' = sold; source='case_drop'
--    = only obtainable via case opening.  image_url is null for now — supply
--    your own PNGs later and update via UPDATE statements or the admin UI.
-- ============================================================================

insert into public.market_items (slug, name, description, category, rarity, shop_price, source, metadata) values
  -- Shop badges
  ('badge-rookie',       'Rookie',            'Everyone starts somewhere.',                 'badge', 'common',    50,   'shop',     '{"emoji":"🌱"}'),
  ('badge-high-roller',  'High Roller',       'Ante up. Make it hurt.',                     'badge', 'uncommon',  400,  'shop',     '{"emoji":"💵"}'),
  ('badge-lucky-seven',  'Lucky Seven',       'The favourite superstition.',                'badge', 'rare',      1200, 'shop',     '{"emoji":"🎰"}'),
  ('badge-devilish',     'Devilish Streak',   'Red hot run? Let the world know.',           'badge', 'epic',      4500, 'shop',     '{"emoji":"👹"}'),
  ('badge-royal',        'Royal Crown',       'For those who flash enormous bankrolls.',    'badge', 'legendary', 20000,'shop',     '{"emoji":"👑"}'),

  -- Shop titles
  ('title-the-rookie',   'Title · The Rookie',    'Worn humbly under your name.',           'title', 'common',    30,   'shop',     '{"text":"The Rookie"}'),
  ('title-the-whale',    'Title · The Whale',     'Earn the respect of the house.',         'title', 'rare',      2500, 'shop',     '{"text":"The Whale"}'),
  ('title-degenerate',   'Title · Degenerate',    'A lifestyle choice, displayed proudly.', 'title', 'epic',      6000, 'shop',     '{"text":"Degenerate"}'),
  ('title-immortal',     'Title · Immortal',      'Legends never lose. Legends win BIG.',   'title', 'legendary', 30000,'shop',     '{"text":"Immortal"}'),

  -- Shop frames (profile avatar frame)
  ('frame-neon-cyan',    'Frame · Neon Cyan',     'Signature house colour.',                'frame', 'uncommon',  300,  'shop',     '{"color":"#22e1ff"}'),
  ('frame-neon-magenta', 'Frame · Neon Magenta',  'Hot pink, because why not.',             'frame', 'uncommon',  300,  'shop',     '{"color":"#ff2bd6"}'),
  ('frame-gold',         'Frame · 24k',            'Bathed in gold.',                        'frame', 'rare',      1500, 'shop',     '{"color":"#ffd96b"}'),
  ('frame-prismatic',    'Frame · Prismatic',      'Shifting through the whole spectrum.',   'frame', 'epic',      5000, 'shop',     '{"color":"prismatic"}'),

  -- Shop effects (chat / overlay sparkles)
  ('effect-sparkle',     'Effect · Sparkle',       'A little sparkle on every bet.',         'effect','rare',      1800, 'shop',     '{"variant":"sparkle"}'),
  ('effect-fire',        'Effect · Fire trail',    'Your big wins leave a mark.',            'effect','epic',      6500, 'shop',     '{"variant":"fire"}'),

  -- Case-drop only (trophies & exclusive badges)
  ('trophy-case-bronze', 'Trophy · Bronze Spinner','Dropped from any Bronze case.',          'trophy','common',    null, 'case_drop','{"emoji":"🥉"}'),
  ('trophy-case-silver', 'Trophy · Silver Spinner','Dropped from any Silver case.',          'trophy','uncommon',  null, 'case_drop','{"emoji":"🥈"}'),
  ('trophy-case-gold',   'Trophy · Gold Spinner',  'Dropped from any Gold case.',            'trophy','rare',      null, 'case_drop','{"emoji":"🥇"}'),
  ('badge-jackpot',      'Jackpot Medal',          'Case-only. Pulled on a real jackpot.',   'badge', 'jackpot',   null, 'case_drop','{"emoji":"🎰"}'),
  ('badge-ultra',        'Ultra Singularity',      'Case-only. Pulled on an Ultra.',         'badge', 'ultra',     null, 'case_drop','{"emoji":"🌌"}'),
  ('badge-legendary-rx', 'Legendary Mark',          'Case-only. Pulled on a Legendary.',     'badge', 'legendary', null, 'case_drop','{"emoji":"🔥"}'),
  ('frame-case-epic',    'Frame · Case Epic',      'Case-only. Dropped from an Epic.',       'frame', 'epic',      null, 'case_drop','{"color":"#b06bff"}')
on conflict (slug) do nothing;

-- Done.
