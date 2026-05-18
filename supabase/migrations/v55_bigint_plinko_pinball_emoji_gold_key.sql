-- ============================================================================
-- v55_bigint_plinko_pinball_emoji_gold_key.sql
--
-- 1. Plinko batch: widen plinko_batches columns + recreate RPCs as bigint.
--    Also removes the 100 000-credit bet cap.
-- 2. Pinball: widen pinball_rounds columns + recreate RPCs as bigint.
-- 3. Emoji hunt: fix "structure of query does not match function result type"
--    by returning bigint for new_balance (profiles.credits is bigint).
-- 4. Gold key cost: 1.80× → 1.95× (formula was *9/5, now *195/100).
-- 5. Warfront pool override: _warfront_active_pool now respects the
--    warfront_overrides pool when it was set in the current rotation
--    generation, and auto-resets when the rotation changes.
-- ============================================================================

-- ── 1. Plinko — widen table columns ─────────────────────────────────────────

alter table public.plinko_batches
  alter column bet       type bigint using bet::bigint,
  alter column total_bet type bigint using total_bet::bigint,
  alter column payout    type bigint using payout::bigint;

-- Return-type change requires drop-first for both overloads.
drop function if exists public.play_plinko_batch(integer, integer, text, integer);
drop function if exists public.play_plinko_batch(bigint,  integer, text, integer);
drop function if exists public.settle_plinko_batch(uuid, int[]);

create or replace function public.play_plinko_batch(
  p_bet   bigint,
  p_rows  integer default 8,
  p_risk  text    default 'medium',
  p_count integer default 1
) returns table (
  batch_id    uuid,
  new_balance bigint,
  paths       jsonb
)
language plpgsql security definer set search_path = public as $$
declare
  uid       uuid    := auth.uid();
  rows_     int     := coalesce(p_rows,  8);
  risk_     text    := coalesce(p_risk,  'medium');
  cnt       int     := coalesce(p_count, 1);
  total_bet bigint;
  batch_    uuid;
  v_bins    int[]  := '{}';
  v_paths   jsonb  := '[]'::jsonb;
  v_spin    record;
  i_        int;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  perform public._txn_user_lock('plinko');
  if not public.is_game_active('plinko') then
    raise exception 'Plinko is currently out of rotation';
  end if;
  if p_bet is null or p_bet < 1          then raise exception 'bet must be >= 1'; end if;
  if rows_ < 4 or rows_ > 12            then raise exception 'rows must be 4..12'; end if;
  if risk_ not in ('low','medium','high') then raise exception 'risk must be low/medium/high'; end if;
  if cnt < 1 or cnt > 50                then raise exception 'count must be 1..50'; end if;

  total_bet := p_bet * cnt;

  perform public._apply_credit_delta(uid, -total_bet, 'plinko',
    jsonb_build_object('phase','wager','rows',rows_,'risk',risk_,'count',cnt,'per_bet',p_bet));

  for i_ in 1..cnt loop
    select * into v_spin from public._plinko_spin(rows_, risk_);
    v_bins  := array_append(v_bins, v_spin.bin_index);
    v_paths := v_paths || jsonb_build_array(to_jsonb(v_spin.path));
  end loop;

  insert into public.plinko_batches
    (user_id, bet, rows_used, risk, count, total_bet, server_bins)
    values (uid, p_bet, rows_, risk_, cnt, total_bet, v_bins)
    returning id into batch_;

  select credits into new_balance from public.profiles where id = uid;
  return query select batch_, new_balance, v_paths;
end; $$;

grant execute on function public.play_plinko_batch(bigint, integer, text, integer) to authenticated;

create or replace function public.settle_plinko_batch(
  p_batch_id uuid,
  p_bins     int[]
) returns table (
  idx         integer,
  bin_index   integer,
  multiplier  numeric,
  payout      bigint,
  won         boolean,
  new_balance bigint
)
language plpgsql security definer set search_path = public as $$
declare
  uid       uuid    := auth.uid();
  batch     public.plinko_batches%rowtype;
  i_        int;
  bin_      int;
  mult_     numeric;
  pay_      bigint;
  total_pay bigint  := 0;
  mults_    numeric[] := '{}';
  pays_     bigint[]  := '{}';
  bal       bigint;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_batch_id is null then raise exception 'batch id is required'; end if;

  select * into batch
    from public.plinko_batches
   where id = p_batch_id and user_id = uid
   for update;
  if not found then raise exception 'Batch not found'; end if;
  if batch.status <> 'pending' then raise exception 'Batch already settled'; end if;
  if batch.server_bins is null or array_length(batch.server_bins, 1) <> batch.count then
    raise exception 'Server bins missing or count mismatch';
  end if;

  for i_ in 1..batch.count loop
    bin_  := batch.server_bins[i_];
    mult_ := public.plinko_multiplier_for_bin(batch.rows_used, batch.risk, bin_);
    if mult_ is null then
      raise exception 'No multiplier for rows=%, risk=%, bin=%', batch.rows_used, batch.risk, bin_;
    end if;
    pay_      := floor(batch.bet::numeric * mult_)::bigint;
    total_pay := total_pay + pay_;
    mults_    := array_append(mults_, mult_);
    pays_     := array_append(pays_,  pay_);

    insert into public.plinko_drops
      (user_id, bet, rows_used, risk, path, bin_index, multiplier, payout, landed_bin)
      values (uid, batch.bet, batch.rows_used, batch.risk,
              array[]::boolean[], bin_, mult_, pay_, bin_);
  end loop;

  if total_pay > 0 then
    perform public._apply_credit_delta(uid, total_pay, 'plinko',
      jsonb_build_object('phase','payout','rows',batch.rows_used,'risk',batch.risk,
        'count',batch.count,'total_payout',total_pay,'batch_id',p_batch_id));
  end if;

  update public.plinko_batches
     set settled_bins = batch.server_bins,
         payout       = total_pay,
         status       = 'settled',
         settled_at   = now()
   where id = p_batch_id;

  select credits into bal from public.profiles where id = uid;
  for i_ in 1..batch.count loop
    idx         := i_ - 1;
    bin_index   := batch.server_bins[i_];
    multiplier  := mults_[i_];
    payout      := pays_[i_];
    won         := pays_[i_] > batch.bet;
    new_balance := bal;
    return next;
  end loop;
end; $$;

grant execute on function public.settle_plinko_batch(uuid, int[]) to authenticated;


-- ── 2. Pinball — widen table columns ─────────────────────────────────────────

alter table public.pinball_rounds
  alter column bet    type bigint using bet::bigint,
  alter column payout type bigint using payout::bigint;

drop function if exists public.play_pinball_round(integer, integer);
drop function if exists public.play_pinball_round(bigint,  integer);
drop function if exists public.settle_pinball_round(uuid, jsonb);

create or replace function public.play_pinball_round(
  p_bet        bigint,
  p_ball_count integer default 3
) returns table(
  round_id    uuid,
  map_key     text,
  map_name    text,
  seed        bigint,
  ball_count  integer,
  stake       bigint,
  new_balance bigint
)
language plpgsql security definer set search_path = public as $$
declare
  uid         uuid   := auth.uid();
  maps        text[] := array['enchanted_forest','galaxy_drift','deep_sea','inferno_volcano','cyber_circuit'];
  map_names   text[] := array['Enchanted Forest','Galaxy Drift','Deep Sea','Inferno Volcano','Cyber Circuit'];
  choice      int;
  stake_total bigint;
  round_uuid  uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  perform public._txn_user_lock('pinball');
  if not public.is_game_active('pinball') then
    raise exception 'Pinball is currently out of rotation';
  end if;
  if p_bet is null or p_bet < 1 then raise exception 'bet must be >= 1'; end if;
  if p_ball_count is null or p_ball_count < 1 or p_ball_count > 5 then
    raise exception 'ball count must be 1..5';
  end if;

  stake_total := p_bet * p_ball_count;
  choice      := 1 + floor(random() * array_length(maps, 1))::int;
  map_key     := maps[choice];
  map_name    := map_names[choice];
  seed        := floor(random() * 1000000000000)::bigint;

  perform public._apply_credit_delta(uid, -stake_total, 'pinball',
    jsonb_build_object('phase','wager','bet',p_bet,'balls',p_ball_count,
      'map_key',map_key,'map_name',map_name,'seed',seed));

  insert into public.pinball_rounds (user_id, bet, ball_count, map_key, seed, summary, status)
  values (uid, p_bet, p_ball_count, map_key, seed, '{}'::jsonb, 'active')
  returning id into round_uuid;

  select credits into new_balance from public.profiles where id = uid;
  round_id   := round_uuid;
  ball_count := p_ball_count;
  stake      := stake_total;
  return next;
end; $$;

grant execute on function public.play_pinball_round(bigint, integer) to authenticated;

create or replace function public.settle_pinball_round(
  p_round_id uuid,
  p_summary  jsonb default '{}'::jsonb
) returns table(
  round_id    uuid,
  map_key     text,
  score       integer,
  combo_max   integer,
  payout      bigint,
  new_balance bigint,
  won         boolean,
  summary     jsonb
)
language plpgsql security definer set search_path = public as $$
declare
  uid          uuid   := auth.uid();
  r            public.pinball_rounds%rowtype;
  summary_data jsonb  := coalesce(p_summary, '{}'::jsonb);
  score_local  integer := greatest(coalesce((summary_data->>'score')::integer,      0), 0);
  combo_local  integer := greatest(coalesce((summary_data->>'combo_max')::integer,  0), 0);
  bumper_l     integer := greatest(coalesce((summary_data->>'bumper_hits')::integer, 0), 0);
  target_l     integer := greatest(coalesce((summary_data->>'target_hits')::integer, 0), 0);
  zone_l       integer := greatest(coalesce((summary_data->>'zone_hits')::integer,   0), 0);
  jam_l        integer := greatest(coalesce((summary_data->>'jam_hits')::integer,    0), 0);
  drain_l      integer := greatest(coalesce((summary_data->>'drain_hits')::integer,  0), 0);
  stake_total  bigint;
  payout_total bigint;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  perform public._txn_user_lock('pinball');

  select * into r
    from public.pinball_rounds
   where id = p_round_id and user_id = uid
   for update;
  if not found then raise exception 'Pinball round not found'; end if;
  if r.status <> 'active' then raise exception 'Pinball round already settled'; end if;

  stake_total  := r.bet * r.ball_count;
  payout_total := greatest(0, ceil(score_local::numeric / 100.0)::bigint);

  perform public._apply_credit_delta(uid, payout_total, 'pinball',
    jsonb_build_object('phase','payout','round_id',p_round_id,'map_key',r.map_key,
      'score',score_local,'combo_max',combo_local,'stake',stake_total,'summary',summary_data));

  update public.pinball_rounds
     set score = score_local, combo_max = combo_local,
         bumper_hits = bumper_l, target_hits = target_l,
         zone_hits = zone_l, jam_hits = jam_l, drain_hits = drain_l,
         payout = payout_total, summary = summary_data,
         status = 'settled', settled_at = now()
   where id = r.id;

  select credits into new_balance from public.profiles where id = uid;
  round_id  := r.id;
  map_key   := r.map_key;
  score     := score_local;
  combo_max := combo_local;
  payout    := payout_total;
  won       := payout_total > stake_total;
  summary   := summary_data;
  return next;
end; $$;

grant execute on function public.settle_pinball_round(uuid, jsonb) to authenticated;


-- ── 3. Emoji hunt — fix new_balance return type (profiles.credits = bigint) ──

drop function if exists public.claim_emoji_hunt(uuid);

create or replace function public.claim_emoji_hunt(p_id uuid)
returns table(new_balance bigint, reward integer)
language plpgsql security definer set search_path = public as $$
declare
  uid  uuid := auth.uid();
  hunt public.emoji_hunts%rowtype;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into hunt from public.emoji_hunts where id = p_id for update;
  if not found        then raise exception 'Hunt not found'; end if;
  if hunt.found_by is not null then raise exception 'Already claimed'; end if;
  if hunt.expires_at < now()   then raise exception 'Hunt expired'; end if;

  update public.emoji_hunts
     set found_by = uid, found_at = now()
   where id = p_id;

  perform public._apply_credit_delta(uid, hunt.reward, 'emoji_hunt',
    jsonb_build_object('hunt_id', p_id, 'emoji', hunt.emoji));

  return query
    select p.credits, hunt.reward
      from public.profiles p
     where p.id = uid;
end; $$;

grant execute on function public.claim_emoji_hunt(uuid) to authenticated;


-- ── 4. Gold key cost 1.80× → 1.95× ──────────────────────────────────────────
--
-- 1.95× means: uncommon (1.5× base) < key cost → net loss with uncommon ✓
--              rare (2.0× base) > key cost → tiny net win with rare ✓
-- Per tier: bronze 10→19, silver 50→97, gold 100→195.

create or replace function public.open_case(p_tier text, p_key boolean default false)
returns table(
  new_balance  bigint, tier text, rarity text, reward bigint,
  cost         bigint, pity integer, pity_popped boolean, key_used boolean,
  multiplier   numeric, dropped_item uuid
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
  -- 1.95× surcharge: uncommon (1.5×) is a loss, rare (2×) is a small win
  final_cost := case when p_key then (base_cost * 195) / 100 else base_cost end;

  select case_pity into cur_pity from public.profiles where id = uid for update;
  if cur_pity is null then cur_pity := 0; end if;

  perform public._apply_credit_delta(uid, -final_cost, 'game_case',
    jsonb_build_object('phase','wager','tier',p_tier,'key',p_key));

  r   := random();
  rar := public._case_pick_rarity(r);
  if p_key then
    guard := 0;
    while rar = 'common' and guard < 12 loop
      r     := random();
      rar   := public._case_pick_rarity(r);
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
      jsonb_build_object('phase','reward','tier',p_tier,'rarity',rar,'key',p_key,'pity_hit',pity_hit));
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
  -- 1.95× surcharge
  per_cost   := case when p_key then (base_cost * 195) / 100 else base_cost end;
  total_cost := per_cost * p_count;

  perform public._apply_credit_delta(uid, -total_cost, 'game_case',
    jsonb_build_object('phase','wager','tier',p_tier,'key',p_key,'batch_count',p_count,'per_cost',per_cost));

  select case_pity into cur_pity from public.profiles where id = uid for update;
  if cur_pity is null then cur_pity := 0; end if;

  while i < p_count loop
    r   := random();
    rar := public._case_pick_rarity(r);
    if p_key then
      guard := 0;
      while rar = 'common' and guard < 12 loop
        r     := random();
        rar   := public._case_pick_rarity(r);
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
          'key',p_key,'batch_idx',i,'pity_hit',pit_hit));
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


-- ── 5. Warfront pool override: generation-based auto-reset ───────────────────

alter table public.warfront_overrides
  add column if not exists fantasy_pool_gen bigint,
  add column if not exists animal_pool_gen  bigint;

-- Current rotation generation (mirrors client getActiveWarfrontPool logic)
create or replace function public._warfront_generation()
returns bigint language sql stable set search_path = public as $$
  select floor(
    (floor(extract(epoch from (now() - '2026-01-01 00:00:00+00'::timestamptz)) / 3600)
     - (11 + 5))::numeric / 12
  )::bigint;
$$;

grant execute on function public._warfront_generation() to authenticated;

-- _warfront_active_pool: use admin override when set for the current generation
create or replace function public._warfront_active_pool(
  p_collection text,
  p_n          int default 12
) returns text[] language plpgsql stable as $$
declare
  v_override_pool text[];
  v_override_gen  bigint;
  v_current_gen   bigint := public._warfront_generation();
  v_epoch         timestamptz := '2026-01-01 00:00:00+00';
  v_h_index       bigint;
  v_generation    bigint;
  v_seed          bigint;
  v_ids           text[];
  v_n             int; i int; j int; tmp text;
  v_s             bigint;
begin
  select
    case when p_collection = 'animals' then animal_pool     else fantasy_pool     end,
    case when p_collection = 'animals' then animal_pool_gen else fantasy_pool_gen end
  into v_override_pool, v_override_gen
  from public.warfront_overrides
  where id = true;

  if v_override_pool is not null and v_override_gen = v_current_gen then
    return v_override_pool[1:least(p_n, array_length(v_override_pool, 1))];
  end if;

  -- Seeded rotation fallback
  v_h_index    := floor(extract(epoch from (now() - v_epoch)) / 3600)::bigint;
  v_generation := floor((v_h_index - (11 + 5))::numeric / 12)::bigint;
  v_seed       := v_generation # (case when p_collection = 'animals' then 1515870810 else 2779096485 end);

  v_ids := case when p_collection = 'animals'
    then array['rat','wolfpack','squirrel','tortoise','eagle','bee','bat','kangaroo',
               'viper','bear','chameleon','jellyfish','mantisshrimp','scorpion','skunk',
               'zebra','rhino','crocodile','giraffe','tiger','gorilla','shark','elephant','whale']
    else array['peasant','footman','bombgoblin','archer','assassin','shaman','lumberjack',
               'angel','brute','cavalry','harpy','troll','voidwalker','frostwitch','mage',
               'mirrormage','necromancer','genie','phoenix','warlord','siege','stormdrake',
               'timewizard','golem']
  end;
  v_n := array_length(v_ids, 1);
  v_s := v_seed & 4294967295;
  for i in reverse v_n..2 loop
    v_s := ((v_s * 1664525) + 1013904223) & 4294967295;
    j   := 1 + (v_s % i)::int;
    tmp := v_ids[i]; v_ids[i] := v_ids[j]; v_ids[j] := tmp;
  end loop;
  return v_ids[1:least(p_n, v_n)];
end; $$;

grant execute on function public._warfront_active_pool(text, int) to authenticated;

-- admin_set_warfront_overrides: record the generation when pool is set
-- so it auto-expires when the rotation changes.
create or replace function public.admin_set_warfront_overrides(
  p_fantasy_pool  text[]  default null,
  p_animal_pool   text[]  default null,
  p_fantasy_stats jsonb   default null,
  p_animal_stats  jsonb   default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_admin boolean;
  v_gen   bigint := public._warfront_generation();
begin
  select is_admin into v_admin from public.profiles where id = auth.uid();
  if not coalesce(v_admin, false) then raise exception 'Admin privileges required'; end if;

  update public.warfront_overrides
     set fantasy_pool     = p_fantasy_pool,
         fantasy_pool_gen = case when p_fantasy_pool is not null then v_gen else null end,
         animal_pool      = p_animal_pool,
         animal_pool_gen  = case when p_animal_pool is not null then v_gen else null end,
         fantasy_stats    = coalesce(p_fantasy_stats, '{}'::jsonb),
         animal_stats     = coalesce(p_animal_stats,  '{}'::jsonb),
         updated_at       = now()
   where id = true;
end; $$;

revoke all  on function public.admin_set_warfront_overrides(text[], text[], jsonb, jsonb) from public;
grant execute on function public.admin_set_warfront_overrides(text[], text[], jsonb, jsonb) to service_role, authenticated;

-- get_warfront_overrides: return null for pools whose generation has expired
create or replace function public.get_warfront_overrides()
returns json language sql stable security definer set search_path = public as $$
  select row_to_json(r) from (
    select
      case when fantasy_pool_gen = public._warfront_generation() then fantasy_pool else null end as fantasy_pool,
      case when animal_pool_gen  = public._warfront_generation() then animal_pool  else null end as animal_pool,
      fantasy_stats,
      animal_stats
    from public.warfront_overrides
    where id = true
  ) r;
$$;

grant execute on function public.get_warfront_overrides() to authenticated, anon;

-- ============================================================================
-- Done.
-- ============================================================================
