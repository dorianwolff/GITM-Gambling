-- ============================================================================
-- v52_gold_key_cost_rebalance.sql
--
-- Raises the gold-key surcharge from 1.5× to 1.8× base cost.
--
-- Old: key cost = floor(base * 3 / 2)  = 1.50× base
--   → uncommon pays base*1.5 = key cost → break-even (EV+ overall)
--
-- New: key cost = floor(base * 9 / 5)  = 1.80× base
--   → uncommon pays base*1.5 < key cost → slight loss  ✓
--   → rare     pays base*2.0 > key cost → slight win   ✓
--
-- Per-tier effect:
--   bronze (10 cr base): key 15 → 18  |  uncommon 15 → -3  |  rare 20 → +2
--   silver (50 cr base): key 75 → 90  |  uncommon 75 → -15 |  rare 100 → +10
--   gold  (100 cr base): key 150→180  |  uncommon 150→ -30 |  rare 200 → +20
-- ============================================================================

-- ─── open_case (single) ─────────────────────────────────────────────────────

create or replace function public.open_case(p_tier text, p_key boolean default false)
returns table(
  new_balance integer, tier text, rarity text, reward integer,
  cost integer, pity integer, pity_popped boolean, key_used boolean,
  multiplier numeric, dropped_item uuid
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
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
  item uuid;
  guard int;
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
  -- 1.8× surcharge: uncommon (1.5×) is a loss, rare (2×) is a small win
  final_cost := case when p_key then (base_cost * 9) / 5 else base_cost end;

  select case_pity into cur_pity from public.profiles where id = uid for update;
  if cur_pity is null then cur_pity := 0; end if;

  perform public._apply_credit_delta(uid, -final_cost, 'game_case',
    jsonb_build_object('phase','wager','tier',p_tier,'key',p_key));

  r := random();
  rar := public._case_pick_rarity(r);
  if p_key then
    guard := 0;
    while rar = 'common' and guard < 12 loop
      r := random();
      rar := public._case_pick_rarity(r);
      guard := guard + 1;
    end loop;
    if rar = 'common' then rar := 'uncommon'; end if;
  end if;

  if not p_key and rar = 'common' and cur_pity >= 9 then
    rar := 'rare';
    pity_hit := true;
  end if;

  mult := public._case_mult(rar);
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

-- ─── open_case_batch (multi) ────────────────────────────────────────────────

create or replace function public.open_case_batch(
  p_tier text, p_key boolean, p_count integer
) returns table(
  idx integer, rarity text, reward integer, mult numeric,
  pity_hit boolean, cost integer, dropped_item uuid
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
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
  item uuid;
  guard int;
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
  -- 1.8× surcharge: uncommon (1.5×) is a loss, rare (2×) is a small win
  per_cost := case when p_key then (base_cost * 9) / 5 else base_cost end;
  total_cost := per_cost * p_count;

  perform public._apply_credit_delta(uid, -total_cost, 'game_case',
    jsonb_build_object('phase','wager','tier',p_tier,'key',p_key,
      'batch_count', p_count, 'per_cost', per_cost));

  select case_pity into cur_pity from public.profiles where id = uid for update;
  if cur_pity is null then cur_pity := 0; end if;

  while i < p_count loop
    r := random();
    rar := public._case_pick_rarity(r);
    if p_key then
      guard := 0;
      while rar = 'common' and guard < 12 loop
        r := random();
        rar := public._case_pick_rarity(r);
        guard := guard + 1;
      end loop;
      if rar = 'common' then rar := 'uncommon'; end if;
    end if;
    pit_hit := false;
    if not p_key and rar = 'common' and cur_pity >= 9 then
      rar := 'rare'; pit_hit := true;
    end if;

    m := public._case_mult(rar);
    rew := floor(base_cost * m)::int;

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
-- Done.
-- ============================================================================
