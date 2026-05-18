-- ============================================================================
-- v51_warfront_cost_and_budget_fixes.sql
--
-- Fix 1: Cost mismatches between _warfront_units() and the JS client.
--   timewizard:  SQL had cost=4, JS has cost=3  → fix to 3
--   genie:       SQL had cost=5, JS has cost=4  → fix to 4
--
-- Fix 2: _warfront_enemy_army always spends its full budget.
--   Old logic fell back to hardcoded "footman"/"peasant" (animals: "rat"/
--   "wolfpack") and exited immediately if those units weren't in the current
--   12-unit rotation pool, leaving gold on the table.
--   New logic:
--     a) When the random pick exceeds remaining budget, select a random
--        affordable unit from the active pool instead.
--     b) After the main loop, if gold still remains, top up with the cheapest
--        unit from the full roster (not pool-gated) so the enemy always
--        arrives at exactly their budget.
-- ============================================================================

-- ── 1. Fix unit costs in _warfront_units() ───────────────────────────────────

create or replace function public._warfront_units()
returns jsonb language sql immutable as $$
select jsonb_build_array(
  jsonb_build_object('id','peasant','name','Peasant','icon','🧑','cost',1,'hp',56,'dmg',3,'spd',52,'atk_rate',1.4,'aoe',0,'lane','ground','melee',true,'ranged',false,'rusher',false,'can_air',false,'prioritise_air',false,'engageR',36,'baseEngR',36,'aoeShield',1,'regenPerSec',0,'healRange',0,'reflectPct',0,'slowDur',0,'airMult',1,'aoeResist',1,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',false,'isPx',false,'isAss',false,'isShaman',false,'isNecro',false,'isWarlord',false,'isFootman',false,'isArcher',false,'isBrute',false,'isCav',false,'isVoid',false,'isGoblin',false,'collection','fantasy'),
  jsonb_build_object('id','footman','name','Footman','icon','🛡','cost',1,'hp',65,'dmg',6,'spd',43,'atk_rate',1.2,'aoe',0,'lane','ground','melee',true,'ranged',false,'rusher',false,'can_air',false,'prioritise_air',false,'engageR',36,'baseEngR',36,'aoeShield',0,'regenPerSec',0,'healRange',0,'reflectPct',0,'slowDur',0,'airMult',1,'aoeResist',1,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',false,'isPx',false,'isAss',false,'isShaman',false,'isNecro',false,'isWarlord',false,'isFootman',true,'isArcher',false,'isBrute',false,'isCav',false,'isVoid',false,'isGoblin',false,'collection','fantasy'),
  jsonb_build_object('id','bombgoblin','name','Bomb Goblin','icon','💥','cost',1,'hp',43,'dmg',36,'spd',100,'atk_rate',999,'aoe',54,'lane','ground','melee',true,'ranged',false,'rusher',true,'can_air',false,'prioritise_air',false,'engageR',36,'baseEngR',36,'aoeShield',0,'regenPerSec',0,'healRange',0,'reflectPct',0,'slowDur',0,'airMult',1,'aoeResist',1,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',true,'isPx',false,'isAss',false,'isShaman',false,'isNecro',false,'isWarlord',false,'isFootman',false,'isArcher',false,'isBrute',false,'isCav',false,'isVoid',false,'isGoblin',true,'collection','fantasy'),
  jsonb_build_object('id','archer','name','Archer','icon','🏹','cost',2,'hp',31,'dmg',8,'spd',41,'atk_rate',0.9,'aoe',0,'lane','ground','melee',false,'ranged',true,'rusher',false,'can_air',true,'prioritise_air',true,'engageR',151,'baseEngR',151,'aoeShield',0,'regenPerSec',0,'healRange',0,'reflectPct',0,'slowDur',0,'airMult',2,'aoeResist',1,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',false,'isPx',false,'isAss',false,'isShaman',false,'isNecro',false,'isWarlord',false,'isFootman',false,'isArcher',true,'isBrute',false,'isCav',false,'isVoid',false,'isGoblin',false,'collection','fantasy'),
  jsonb_build_object('id','assassin','name','Assassin','icon','🗡','cost',2,'hp',74,'dmg',24,'spd',68,'atk_rate',1.4,'aoe',0,'lane','ground','melee',true,'ranged',false,'rusher',false,'can_air',false,'prioritise_air',false,'engageR',36,'baseEngR',36,'aoeShield',0,'regenPerSec',0,'healRange',0,'reflectPct',0,'slowDur',0,'airMult',1,'aoeResist',1,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',false,'isPx',false,'isAss',true,'isShaman',false,'isNecro',false,'isWarlord',false,'isFootman',false,'isArcher',false,'isBrute',false,'isCav',false,'isVoid',false,'isGoblin',false,'flyingVulnMult',2,'collection','fantasy'),
  jsonb_build_object('id','shaman','name','Shaman','icon','✦','cost',2,'hp',44,'dmg',0,'spd',45,'atk_rate',999,'aoe',0,'lane','ground','melee',false,'ranged',true,'rusher',false,'can_air',false,'prioritise_air',false,'engageR',200,'baseEngR',200,'aoeShield',0,'regenPerSec',0,'healRange',0,'reflectPct',0,'slowDur',0,'airMult',1,'aoeResist',1,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',false,'isPx',false,'isAss',false,'isShaman',true,'isNecro',false,'isWarlord',false,'isFootman',false,'isArcher',false,'isBrute',false,'isCav',false,'isVoid',false,'isGoblin',false,'collection','fantasy'),
  jsonb_build_object('id','lumberjack','name','Lumberjack','icon','🪓','cost',2,'hp',68,'dmg',12,'spd',65,'atk_rate',0.6,'aoe',0,'lane','ground','melee',true,'ranged',false,'rusher',false,'can_air',false,'prioritise_air',false,'engageR',36,'baseEngR',36,'aoeShield',0,'regenPerSec',0,'healRange',0,'reflectPct',0,'slowDur',0,'airMult',1,'aoeResist',1,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',false,'isPx',false,'isAss',false,'isShaman',false,'isNecro',false,'isWarlord',false,'isFootman',false,'isArcher',false,'isBrute',false,'isCav',false,'isVoid',false,'isGoblin',false,'lumberjackAxe',true,'collection','fantasy'),
  jsonb_build_object('id','angel','name','Angel','icon','🪽','cost',2,'hp',55,'dmg',0,'spd',60,'atk_rate',999,'aoe',0,'lane','air','melee',false,'ranged',false,'rusher',false,'can_air',false,'prioritise_air',false,'engageR',200,'baseEngR',200,'aoeShield',0,'regenPerSec',0,'healRange',0,'reflectPct',0,'slowDur',0,'airMult',1,'aoeResist',1,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',false,'isPx',false,'isAss',false,'isShaman',false,'isNecro',false,'isWarlord',false,'isFootman',false,'isArcher',false,'isBrute',false,'isCav',false,'isVoid',false,'isGoblin',false,'isAngel',true,'angelCooldown',2,'collection','fantasy'),
  jsonb_build_object('id','brute','name','Brute','icon','⚔','cost',3,'hp',111,'dmg',18,'spd',60,'atk_rate',0.9,'aoe',0,'lane','ground','melee',true,'ranged',false,'rusher',false,'can_air',false,'prioritise_air',false,'engageR',36,'baseEngR',36,'aoeShield',0,'regenPerSec',0,'healRange',0,'reflectPct',0,'slowDur',0,'airMult',1,'aoeResist',1,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',false,'isPx',false,'isAss',false,'isShaman',false,'isNecro',false,'isWarlord',false,'isFootman',false,'isArcher',false,'isBrute',true,'isCav',false,'isVoid',false,'isGoblin',false,'collection','fantasy'),
  jsonb_build_object('id','cavalry','name','Cavalry','icon','🐴','cost',3,'hp',72,'dmg',29,'spd',63,'atk_rate',1.8,'aoe',0,'lane','ground','melee',true,'ranged',false,'rusher',true,'can_air',false,'prioritise_air',false,'engageR',36,'baseEngR',36,'aoeShield',0,'regenPerSec',0,'healRange',0,'reflectPct',0,'slowDur',0,'airMult',1,'aoeResist',1,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',false,'isPx',false,'isAss',false,'isShaman',false,'isNecro',false,'isWarlord',false,'isFootman',false,'isArcher',false,'isBrute',false,'isCav',true,'isVoid',false,'isGoblin',false,'collection','fantasy'),
  jsonb_build_object('id','harpy','name','Harpy','displayName','Fairy','icon','🧚‍♀️','cost',3,'hp',53,'dmg',9,'spd',89,'atk_rate',1.3,'aoe',0,'lane','air','melee',true,'ranged',false,'rusher',true,'can_air',true,'prioritise_air',false,'engageR',36,'baseEngR',36,'aoeShield',0,'regenPerSec',0,'healRange',0,'reflectPct',0,'slowDur',0,'airMult',1,'aoeResist',0.5,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',false,'isPx',false,'isAss',false,'isShaman',false,'isNecro',false,'isWarlord',false,'isFootman',false,'isArcher',false,'isBrute',false,'isCav',false,'isVoid',false,'isGoblin',false,'collection','fantasy'),
  jsonb_build_object('id','troll','name','Troll','icon','👹','cost',3,'hp',156,'dmg',13,'spd',48,'atk_rate',1.3,'aoe',0,'lane','ground','melee',true,'ranged',false,'rusher',false,'can_air',false,'prioritise_air',false,'engageR',36,'baseEngR',36,'aoeShield',0,'regenPerSec',3,'healRange',0,'reflectPct',0,'slowDur',0,'airMult',1,'aoeResist',1,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',false,'isPx',false,'isAss',false,'isShaman',false,'isNecro',false,'isWarlord',false,'isFootman',false,'isArcher',false,'isBrute',false,'isCav',false,'isVoid',false,'isGoblin',false,'collection','fantasy'),
  jsonb_build_object('id','voidwalker','name','Voidwalker','icon','👾','cost',3,'hp',97,'dmg',20,'spd',62,'atk_rate',1.1,'aoe',0,'lane','ground','melee',true,'ranged',false,'rusher',false,'can_air',false,'prioritise_air',false,'engageR',36,'baseEngR',36,'aoeShield',0,'regenPerSec',0,'healRange',0,'reflectPct',0,'slowDur',0,'airMult',1,'aoeResist',1,'chain',0,'voidCycle',5,'voidDur',1.5,'isSelf',false,'isPx',false,'isAss',false,'isShaman',false,'isNecro',false,'isWarlord',false,'isFootman',false,'isArcher',false,'isBrute',false,'isCav',false,'isVoid',true,'isGoblin',false,'collection','fantasy'),
  jsonb_build_object('id','frostwitch','name','Frost Witch','icon','❄','cost',4,'hp',109,'dmg',19,'spd',44,'atk_rate',1.6,'aoe',0,'lane','ground','melee',false,'ranged',true,'rusher',false,'can_air',true,'prioritise_air',false,'engageR',185,'baseEngR',185,'aoeShield',0,'regenPerSec',0,'healRange',0,'reflectPct',0,'slowDur',2.0,'frostSlowPct',0.7,'airMult',1,'aoeResist',1,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',false,'isPx',false,'isAss',false,'isShaman',false,'isNecro',false,'isWarlord',false,'isFootman',false,'isArcher',false,'isBrute',false,'isCav',false,'isVoid',false,'isGoblin',false,'collection','fantasy'),
  jsonb_build_object('id','mage','name','Mage','icon','🔮','cost',4,'hp',48,'dmg',22,'spd',42,'atk_rate',1.6,'aoe',50,'lane','ground','melee',false,'ranged',true,'rusher',false,'can_air',true,'prioritise_air',true,'engageR',150,'baseEngR',150,'aoeShield',0,'regenPerSec',0,'healRange',0,'reflectPct',0,'slowDur',0,'airMult',1,'aoeResist',1,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',false,'isPx',false,'isAss',false,'isShaman',false,'isNecro',false,'isWarlord',false,'isFootman',false,'isArcher',false,'isBrute',false,'isCav',false,'isVoid',false,'isGoblin',false,'collection','fantasy'),
  jsonb_build_object('id','mirrormage','name','Mirror Mage','icon','🪞','cost',4,'hp',96,'dmg',16,'spd',40,'atk_rate',1.5,'aoe',0,'lane','ground','melee',false,'ranged',true,'rusher',false,'can_air',true,'prioritise_air',false,'engageR',140,'baseEngR',140,'aoeShield',0,'regenPerSec',0,'healRange',0,'reflectPct',0,'slowDur',0,'airMult',1,'aoeResist',1,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',false,'isPx',false,'isAss',false,'isShaman',false,'isNecro',false,'isWarlord',false,'isFootman',false,'isArcher',false,'isBrute',false,'isCav',false,'isVoid',false,'isGoblin',false,'mirrorAll',true,'collection','fantasy'),
  jsonb_build_object('id','necromancer','name','Necromancer','icon','💀','cost',4,'hp',102,'dmg',21,'spd',35,'atk_rate',1.9,'aoe',0,'lane','ground','melee',false,'ranged',true,'rusher',false,'can_air',false,'prioritise_air',false,'engageR',140,'baseEngR',140,'aoeShield',0,'regenPerSec',0,'healRange',0,'reflectPct',0,'slowDur',0,'airMult',1,'aoeResist',1,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',false,'isPx',false,'isAss',false,'isShaman',false,'isNecro',true,'isWarlord',false,'isFootman',false,'isArcher',false,'isBrute',false,'isCav',false,'isVoid',false,'isGoblin',false,'collection','fantasy'),
  -- timewizard: cost corrected from 4 → 3 to match JS client
  jsonb_build_object('id','timewizard','name','Time Wizard','icon','⏳','cost',3,'hp',108,'dmg',15,'spd',36,'atk_rate',2.1,'aoe',0,'lane','ground','melee',false,'ranged',true,'rusher',false,'can_air',false,'prioritise_air',false,'engageR',80,'baseEngR',80,'aoeShield',0,'regenPerSec',0,'healRange',0,'reflectPct',0,'slowDur',0,'airMult',1,'aoeResist',1,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',false,'isPx',false,'isAss',false,'isShaman',false,'isNecro',false,'isWarlord',false,'isFootman',false,'isArcher',false,'isBrute',false,'isCav',false,'isVoid',false,'isGoblin',false,'collection','fantasy'),
  jsonb_build_object('id','phoenix','name','Phoenix','icon','🔥','cost',5,'hp',66,'dmg',18,'spd',66,'atk_rate',1.4,'aoe',40,'lane','air','melee',false,'ranged',true,'rusher',false,'can_air',true,'prioritise_air',false,'engageR',140,'baseEngR',140,'aoeShield',0,'regenPerSec',0,'healRange',0,'reflectPct',0,'slowDur',0,'airMult',1,'aoeResist',1,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',false,'isPx',true,'isAss',false,'isShaman',false,'isNecro',false,'isWarlord',false,'isFootman',false,'isArcher',false,'isBrute',false,'isCav',false,'isVoid',false,'isGoblin',false,'collection','fantasy'),
  jsonb_build_object('id','warlord','name','Warlord','icon','👑','cost',5,'hp',152,'dmg',20,'spd',38,'atk_rate',1.1,'aoe',0,'lane','ground','melee',true,'ranged',false,'rusher',false,'can_air',false,'prioritise_air',false,'engageR',36,'baseEngR',36,'aoeShield',0,'regenPerSec',0,'healRange',0,'reflectPct',0,'slowDur',0,'airMult',1,'aoeResist',1,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',false,'isPx',false,'isAss',false,'isShaman',false,'isNecro',false,'isWarlord',true,'isFootman',false,'isArcher',false,'isBrute',false,'isCav',false,'isVoid',false,'isGoblin',false,'collection','fantasy'),
  jsonb_build_object('id','siege','name','Siege Engine','icon','💣','cost',5,'hp',60,'dmg',41,'spd',27,'atk_rate',2.1,'aoe',62,'lane','ground','melee',false,'ranged',true,'rusher',false,'can_air',false,'prioritise_air',false,'engageR',160,'baseEngR',160,'aoeShield',0,'regenPerSec',0,'healRange',0,'reflectPct',0,'slowDur',0,'airMult',1,'aoeResist',1,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',false,'isPx',false,'isAss',false,'isShaman',false,'isNecro',false,'isWarlord',false,'isFootman',false,'isArcher',false,'isBrute',false,'isCav',false,'isVoid',false,'isGoblin',false,'collection','fantasy'),
  jsonb_build_object('id','stormdrake','name','Storm Drake','icon','🐲','cost',5,'hp',82,'dmg',19,'spd',70,'atk_rate',1.8,'aoe',0,'lane','air','melee',false,'ranged',true,'rusher',false,'can_air',true,'prioritise_air',false,'engageR',160,'baseEngR',160,'aoeShield',0,'regenPerSec',0,'healRange',0,'reflectPct',0,'slowDur',0,'airMult',1,'aoeResist',1,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',false,'isPx',false,'isAss',false,'isShaman',false,'isNecro',false,'isWarlord',false,'isFootman',false,'isArcher',false,'isBrute',false,'isCav',false,'isVoid',false,'isGoblin',false,'collection','fantasy'),
  -- genie: cost corrected from 5 → 4 to match JS client
  jsonb_build_object('id','genie','name','Genie','icon','🧞','cost',4,'hp',163,'dmg',17,'spd',45,'atk_rate',1.3,'aoe',0,'lane','ground','melee',true,'ranged',false,'rusher',false,'can_air',false,'prioritise_air',false,'engageR',36,'baseEngR',36,'aoeShield',0,'regenPerSec',0,'healRange',0,'reflectPct',0,'slowDur',0,'airMult',1,'aoeResist',1,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',false,'isPx',false,'isAss',false,'isShaman',false,'isNecro',false,'isWarlord',false,'isFootman',false,'isArcher',false,'isBrute',false,'isCav',false,'isVoid',false,'isGoblin',false,'collection','fantasy'),
  jsonb_build_object('id','golem','name','Golem','icon','🗿','cost',6,'hp',354,'dmg',33,'spd',24,'atk_rate',2.0,'aoe',42,'lane','ground','melee',true,'ranged',false,'rusher',false,'can_air',false,'prioritise_air',false,'engageR',36,'baseEngR',36,'aoeShield',0,'regenPerSec',0,'healRange',0,'reflectPct',0,'slowDur',0,'airMult',1,'aoeResist',1,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',false,'isPx',false,'isAss',false,'isShaman',false,'isNecro',false,'isWarlord',false,'isFootman',false,'isArcher',false,'isBrute',false,'isCav',false,'isVoid',false,'isGoblin',false,'collection','fantasy')
)::jsonb;
$$;

-- ── 2. Fix _warfront_enemy_army to always spend the full budget ───────────────
--
-- Old bug: when a random unit was too expensive, the function fell back to a
-- hardcoded cheap unit (footman/peasant or rat/wolfpack).  If that unit wasn't
-- in the current 12-unit rotation pool it immediately exit-ed the loop,
-- leaving gold unspent.
--
-- New logic:
--   • When the random pick is too expensive, choose a random AFFORDABLE unit
--     from the pool instead.
--   • After the main pool-restricted loop, if budget still remains, top it up
--     with the cheapest unit from the full roster (not pool-restricted) so the
--     enemy always arrives at exactly their budget.

drop function if exists public._warfront_enemy_army(integer, text, text[]);
drop function if exists public._warfront_enemy_army(integer, text);

create or replace function public._warfront_enemy_army(
  p_budget      int,
  p_collection  text    default 'fantasy',
  p_player_picks text[] default '{}'
) returns jsonb language plpgsql stable as $$
declare
  v_units  jsonb   := case when p_collection = 'animals'
                            then public._warfront_animal_units()
                            else public._warfront_units() end;
  v_ids    text[]  := public._warfront_active_pool(p_collection, 12);
  v_army   text[]  := '{}';
  v_budget int     := p_budget;
  v_cost   int;
  v_id     text;
  v_u      jsonb;
  v_has_ranged boolean := false;
  v_tries  int := 0;
  v_min_pool_cost int;
  v_min_any_cost  int;
begin
  -- cheapest cost available inside the pool
  select min((u->>'cost')::int) into v_min_pool_cost
  from jsonb_array_elements(v_units) u
  where u->>'id' = any(v_ids);
  v_min_pool_cost := coalesce(v_min_pool_cost, 999);

  -- ── Main loop: spend from pool ────────────────────────────────────────────
  while v_budget >= v_min_pool_cost and v_tries < 300 loop
    v_tries := v_tries + 1;

    -- pick a random unit from the pool
    v_id := v_ids[1 + floor(random() * array_length(v_ids, 1))::int];

    -- 50% bias against mirroring the player's own picks
    if v_id = any(p_player_picks) and random() < 0.5 then continue; end if;

    select u into v_u
    from jsonb_array_elements(v_units) u
    where u->>'id' = v_id;

    v_cost := coalesce((v_u->>'cost')::int, 999);

    -- if this unit doesn't fit, pick a random affordable alternative from the pool
    if v_cost > v_budget then
      select u->>'id', (u->>'cost')::int
      into   v_id,     v_cost
      from   jsonb_array_elements(v_units) u
      where  u->>'id' = any(v_ids)
        and  (u->>'cost')::int <= v_budget
      order  by random()
      limit  1;
      if v_id is null then exit; end if;
      select u into v_u
      from   jsonb_array_elements(v_units) u
      where  u->>'id' = v_id;
    end if;

    v_army   := array_append(v_army, v_id);
    v_budget := v_budget - v_cost;

    if coalesce((v_u->>'ranged')::boolean, false)
    or coalesce((v_u->>'can_air')::boolean, false) then
      v_has_ranged := true;
    end if;
  end loop;

  -- ── Budget top-up: fill any remaining gold with cheapest available unit ───
  -- (not pool-restricted — guarantees the enemy always spends their full budget)
  if v_budget > 0 then
    select min((u->>'cost')::int) into v_min_any_cost
    from jsonb_array_elements(v_units) u;
    v_min_any_cost := coalesce(v_min_any_cost, 999);

    while v_budget >= v_min_any_cost loop
      select u->>'id'
      into   v_id
      from   jsonb_array_elements(v_units) u
      where  (u->>'cost')::int <= v_budget
      order  by (u->>'cost')::int asc, random()
      limit  1;

      exit when v_id is null;

      select u into v_u
      from   jsonb_array_elements(v_units) u
      where  u->>'id' = v_id;

      v_army   := array_append(v_army, v_id);
      v_budget := v_budget - (v_u->>'cost')::int;

      if coalesce((v_u->>'ranged')::boolean, false)
      or coalesce((v_u->>'can_air')::boolean, false) then
        v_has_ranged := true;
      end if;
    end loop;
  end if;

  -- ── Ensure at least one ranged/air unit ───────────────────────────────────
  if not v_has_ranged and array_length(v_army, 1) > 0 then
    select u->>'id' into v_id
    from   jsonb_array_elements(v_units) u
    where  u->>'id' = any(v_ids)
      and  (coalesce((u->>'ranged')::boolean, false)
            or coalesce((u->>'can_air')::boolean, false))
    limit  1;
    if v_id is not null then v_army[1] := v_id; end if;
  end if;

  return to_jsonb(v_army);
end;
$$;

-- ============================================================================
-- Done.
-- ============================================================================
