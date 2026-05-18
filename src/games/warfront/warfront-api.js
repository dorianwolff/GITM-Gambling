/**
 * warfront-api.js
 * Thin wrapper over the play_warfront RPC.
 */
import { supabase } from '../../lib/supabase.js';

export const WARFRONT_FANTASY_UNITS = Object.freeze([
  { id:'peasant', name:'Peasant', icon:'🧑', cost:1, hp:56,  dmg:3,  spd:52,  atkRate:1.4, aoe:0,  lane:'ground', melee:true,  ranged:false, rusher:false, canHitFlying:false, prioritiseAir:false, engageR:36,  baseEngR:36,  aoeShield:1,  regenPerSec:0, healRange:0,   reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, collection:'fantasy', tags:['ground','melee','special'], tip:'Shield Bearer passively absorbs 40% of AoE damage hitting nearby allies. Fragile.' },
  { id:'footman', name:'Footman', icon:'🛡', cost:1, hp:63,  dmg:6,  spd:43,  atkRate:1.2, aoe:0,  lane:'ground', melee:true,  ranged:false, rusher:false, canHitFlying:false, prioritiseAir:false, engageR:36,  baseEngR:36,  aoeShield:0,  regenPerSec:0, healRange:0,   reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:true, isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, collection:'fantasy', tags:['ground','melee'], tip:'Wall unit (1g). Crumbles to AoE.' },
  { id:'bombgoblin', name:'Bomb Goblin', icon:'💥', cost:1, hp:43,  dmg:36, spd:100, atkRate:999, aoe:54, lane:'ground', melee:true,  ranged:false, rusher:true,  canHitFlying:false, prioritiseAir:false, engageR:36,  baseEngR:36,  aoeShield:0,  regenPerSec:0, healRange:0,   reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:true, isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:true, collection:'fantasy', tags:['ground','melee','rusher','aoe','special'], tip:'Kamikaze sprints into the largest enemy cluster and self-destructs. Devastating vs blobs.' },
  { id:'archer', name:'Archer', icon:'🏹', cost:2, hp:29,  dmg:8,  spd:41,  atkRate:0.9, aoe:0,  lane:'ground', melee:false, ranged:true,  rusher:false, canHitFlying:true,  prioritiseAir:true,  engageR:151, baseEngR:151, aoeShield:0,  regenPerSec:0, healRange:0,   reflectPct:0,    slowDur:0,   airMult:2, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:true, isBrute:false,isCav:false,isVoid:false,isGoblin:false, collection:'fantasy', tags:['ground','ranged'], tip:'Ranged attacks ground and air. 2× dmg vs flying. Very fragile — place behind melee.' },
  { id:'assassin', name:'Assassin', icon:'🗡', cost:2, hp:53,  dmg:24, spd:68,  atkRate:1.4, aoe:0,  lane:'ground', melee:true,  ranged:false, rusher:false, canHitFlying:false, prioritiseAir:false, engageR:36,  baseEngR:36,  aoeShield:0,  regenPerSec:0, healRange:0,   reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:true, isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, flyingVulnMult:2, collection:'fantasy', tags:['ground','melee','special'], tip:'Hops 85px toward enemy backline every 0.8s. Burst damage on arrival. Takes 2× damage from flying units.' },
  { id:'shaman', name:'Shaman', icon:'✦', cost:2, hp:44,  dmg:0,  spd:45,  atkRate:999, aoe:0,  lane:'ground', melee:false, ranged:true,  rusher:false, canHitFlying:false, prioritiseAir:false, engageR:200, baseEngR:200, aoeShield:0,  regenPerSec:0, healRange:120, reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:true, isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, collection:'fantasy', tags:['ground','support'], tip:'Heals lowest-HP ally within 120px for 8 every 1.5s. Follows army. Never attacks.' },
  { id:'lumberjack', name:'Lumberjack', icon:'🪓', cost:2, hp:68,  dmg:11, spd:65,  atkRate:0.6, aoe:0,  lane:'ground', melee:true,  ranged:false, rusher:false, canHitFlying:false, prioritiseAir:false, engageR:36,  baseEngR:36,  aoeShield:0,  regenPerSec:0, healRange:0,   reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, lumberjackAxe:true, collection:'fantasy', tags:['ground','melee','special'], tip:'Gains +1 damage for each living enemy. Scales with larger enemy teams. Punishes swarm compositions.' },
  { id:'angel', name:'Angel', icon:'🪽', cost:2, hp:65,  dmg:0,  spd:60,  atkRate:999, aoe:0,  lane:'air',    melee:false, ranged:false, rusher:false, canHitFlying:false, prioritiseAir:false, engageR:200, baseEngR:200, aoeShield:0,  regenPerSec:0, healRange:0,   reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, isAngel:true, angelCooldown:2, collection:'fantasy', tags:['flying','support'], tip:'Flying support that cannot attack. Every 2s blesses a random ground ally with a random buff for 4s: faster attack, +9 dmg, or -30% dmg taken. Double effects if already buffed!' },
  { id:'brute', name:'Brute', icon:'⚔', cost:3, hp:110, dmg:18, spd:60,  atkRate:0.9, aoe:0,  lane:'ground', melee:true,  ranged:false, rusher:false, canHitFlying:false, prioritiseAir:false, engageR:36,  baseEngR:36,  aoeShield:0,  regenPerSec:0, healRange:0,   reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:true, isCav:false,isVoid:false,isGoblin:false, collection:'fantasy', tags:['ground','melee'], tip:'High HP/dmg (3g). Rages below 30% HP (+50% speed).' },
  { id:'cavalry', name:'Cavalry', icon:'🏇', cost:3, hp:72,  dmg:29, spd:63,  atkRate:1.8, aoe:0,  lane:'ground', melee:true,  ranged:false, rusher:true,  canHitFlying:false, prioritiseAir:false, engageR:36,  baseEngR:36,  aoeShield:0,  regenPerSec:0, healRange:0,   reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:true, isVoid:false,isGoblin:false, collection:'fantasy', tags:['ground','melee','rusher'], tip:'Beelines to enemy base (3g). First hit 2× (trample).' },
  { id:'harpy', name:'Fairy', icon:'🧚‍♀️', cost:3, hp:53,  dmg:9,   spd:89,  atkRate:1.3, aoe:0,  lane:'air',    melee:true,  ranged:false, rusher:true,  canHitFlying:true,  prioritiseAir:false, engageR:36,  baseEngR:36,  aoeShield:0,  regenPerSec:0, healRange:0,   reflectPct:0,    slowDur:0,   airMult:1, aoeResist:0.5, chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, collection:'fantasy', tags:['flying','melee','rusher'], tip:'Flying rusher (3g). 50% AoE resistance.' },
  { id:'troll', name:'Troll', icon:'👹', cost:3, hp:154, dmg:13, spd:48,  atkRate:1.3, aoe:0,  lane:'ground', melee:true,  ranged:false, rusher:false, canHitFlying:false, prioritiseAir:false, engageR:36,  baseEngR:36,  aoeShield:0,  regenPerSec:3, healRange:0,   reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, collection:'fantasy', tags:['ground','melee','special'], tip:'Regenerates 3 HP/s (3g). Hard to kill without sustained focus or AoE.' },
  { id:'voidwalker', name:'Voidwalker', icon:'👾', cost:3, hp:97,  dmg:20, spd:62,  atkRate:1.1, aoe:0,  lane:'ground', melee:true,  ranged:false, rusher:false, canHitFlying:false, prioritiseAir:false, engageR:36,  baseEngR:36,  aoeShield:0,  regenPerSec:0, healRange:0,   reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:5, voidDur:1.5, voidDuration:1.5, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:true, isGoblin:false, collection:'fantasy', tags:['ground','melee','special'], tip:'Every 5s phases out 1.5s — immune and untargetable but cannot attack.' },
  { id:'timewizard', name:'Time Wizard', icon:'⏳', cost:3, hp:118, dmg:16, spd:36,  atkRate:2.1, aoe:0,  lane:'ground', melee:false, ranged:true,  rusher:false, canHitFlying:false, prioritiseAir:false, engageR:80,  baseEngR:80,  aoeShield:0,  regenPerSec:0, healRange:0,   reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, spellCooldown:6, collection:'fantasy', tags:['ground','ranged','special'], tip:'Every 6s casts 1 of 3 spells lasting 3s — Time Stop (all frozen), Time Rewind (HP restored), Time Accelerate (3× speed+atk). Unpredictable.' },
  { id:'frostwitch', name:'Frost Witch', icon:'❄', cost:4, hp:104, dmg:18, spd:44,  atkRate:1.6, aoe:0,  lane:'ground', melee:false, ranged:true,  rusher:false, canHitFlying:true,  prioritiseAir:false, engageR:185, baseEngR:185, aoeShield:0,  regenPerSec:0, healRange:0,   reflectPct:0,    slowDur:2.0, frostSlowPct:0.7, airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, collection:'fantasy', tags:['ground','ranged','special'], tip:'Long-range ranged (185px), hits ground + air. Slows target to 30% speed for 2s.' },
  { id:'mage', name:'Mage', icon:'🔮', cost:4, hp:48,  dmg:22, spd:42,  atkRate:1.6, aoe:50, lane:'ground', melee:false, ranged:true,  rusher:false, canHitFlying:true,  prioritiseAir:true,  engageR:150, baseEngR:150, aoeShield:0,  regenPerSec:0, healRange:0,   reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, collection:'fantasy', tags:['ground','ranged','aoe'], tip:'Ranged AoE (4g) — attacks ground and air. Prioritises flying targets.' },
  { id:'mirrormage', name:'Mirror Mage', icon:'🪞', cost:4, hp:98,  dmg:16, spd:40,  atkRate:1.5, aoe:0,  lane:'ground', melee:false, ranged:true,  rusher:false, canHitFlying:true,  prioritiseAir:false, engageR:140, baseEngR:140, aoeShield:0,  regenPerSec:0, healRange:0,   reflectPct:0.4,  slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, mirrorAll:true, collection:'fantasy', tags:['ground','ranged','special'], tip:'Ranged, hits ground + air. Each attack also strikes ALL same-type enemies. Reflects 40% of incoming damage back to attacker.' },
  { id:'necromancer', name:'Necromancer', icon:'💀', cost:4, hp:104, dmg:21, spd:35,  atkRate:1.9, aoe:0,  lane:'ground', melee:false, ranged:true,  rusher:false, canHitFlying:false, prioritiseAir:false, engageR:140, baseEngR:140, aoeShield:0,  regenPerSec:0, healRange:0,   reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:true, isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, collection:'fantasy', tags:['ground','ranged','special'], tip:'Raises a Shade (50% stats) from ANY fallen unit — ally or enemy! Max 3 raises per game.' },
  { id:'genie', name:'Genie', icon:'🧞', cost:4, hp:174, dmg:17, spd:45,  atkRate:1.3, aoe:0,  lane:'ground', melee:true,  ranged:false, rusher:false, canHitFlying:false, prioritiseAir:false, engageR:36,  baseEngR:36,  aoeShield:0,  regenPerSec:0, healRange:0,   reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, wishCooldown:12, collection:'fantasy', tags:['ground','melee','special'], tip:'Every 12s grants a random wish — revive ally, blast all enemies, banish one, or summon a unit. Tanky utility unit.' },
  { id:'phoenix', name:'Phoenix', icon:'🔥', cost:5, hp:66,  dmg:18, spd:66,  atkRate:1.4, aoe:40, lane:'air',    melee:false, ranged:true,  rusher:false, canHitFlying:true,  prioritiseAir:false, engageR:140, baseEngR:140, aoeShield:0,  regenPerSec:0, healRange:0,   reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:true, isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, collection:'fantasy', tags:['flying','ranged','aoe','special'], tip:'Flying AoE (5g). Respawns once at 40% HP after 2s.' },
  { id:'warlord', name:'Warlord', icon:'👑', cost:5, hp:152, dmg:20, spd:38,  atkRate:1.1, aoe:0,  lane:'ground', melee:true,  ranged:false, rusher:false, canHitFlying:false, prioritiseAir:false, engageR:36,  baseEngR:36,  aoeShield:0,  regenPerSec:0, healRange:0,   reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:true, isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, collection:'fantasy', tags:['ground','melee','support'], tip:'All friendly ground units deal +40% damage while the Warlord lives. Slow but tanky frontliner.' },
  { id:'siege', name:'Siege Engine', icon:'💣', cost:5, hp:55,  dmg:40, spd:27,  atkRate:2.1, aoe:62, lane:'ground', melee:false, ranged:true,  rusher:false, canHitFlying:false, prioritiseAir:false, engageR:160, baseEngR:160, aoeShield:0,  regenPerSec:0, healRange:0,   reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, collection:'fantasy', tags:['ground','ranged','aoe'], tip:'Ranged AoE ground only. Bomb lands 420ms after firing. Cannot hit flying.' },
  { id:'stormdrake', name:'Storm Drake', icon:'🐲', cost:5, hp:85,  dmg:19, spd:70,  atkRate:1.8, aoe:0,  lane:'air',    melee:false, ranged:true,  rusher:false, canHitFlying:true,  prioritiseAir:false, engageR:160, baseEngR:160, aoeShield:0,  regenPerSec:0, healRange:0,   reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:3, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, collection:'fantasy', tags:['flying','ranged','special'], tip:'Flying ranged chain lightning hits 3 targets (each bounce −45% dmg).' },
  { id:'golem', name:'Golem', icon:'🗿', cost:6, hp:351, dmg:32, spd:24,  atkRate:2.2, aoe:42, lane:'ground', melee:true,  ranged:false, rusher:false, canHitFlying:false, prioritiseAir:false, engageR:36,  baseEngR:36,  aoeShield:0,  regenPerSec:0, healRange:0,   reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, golemDoubleStrike:true, collection:'fantasy', tags:['ground','melee','aoe'], tip:'Double-strike pattern — slow first stomp, fast follow-up 300ms later. Enormous HP. Must reach targets.' },
]);

export const WARFRONT_ANIMAL_UNITS = Object.freeze([
  { id:'rat', name:'Rat', icon:'🐀', cost:1, hp:22, dmg:7, spd:97, atkRate:0.3, lane:'ground', ranged:false, healer:false, aoe:0, canAir:false, trample:false, phoenix:false, regen:0, reflect:0, slow:0, assassin:false, targeting:'fighter', attackType:'melee', engageRange:36, baseEngageRange:36, tags:['ground','melee','special'], ratContaminate:true, contaminateDmg:10, contaminateDur:6, collection:'animals', tip:'On hit contaminates ALL ground enemies — -10 damage for 6s. Cheap disruptor that punishes physical clusters.' },
  { id:'wolfpack', name:'Wolf Pack', icon:'🐺', cost:1, hp:16, dmg:5, spd:65, atkRate:0.9, lane:'ground', ranged:false, healer:false, aoe:0, canAir:false, trample:false, phoenix:false, regen:0, reflect:0, slow:0, assassin:false, targeting:'fighter', attackType:'melee', engageRange:36, baseEngageRange:36, tags:['ground','melee','special'], twin:true, collection:'animals', tip:'Deploys as 2 wolves for the cost of 1. Best slot efficiency in the roster — double the bodies, one gold.' },
  { id:'squirrel', name:'Squirrel', icon:'🐿', cost:1, hp:28, dmg:7, spd:90, atkRate:0.8, lane:'ground', ranged:false, healer:false, aoe:0, canAir:false, trample:false, phoenix:false, regen:0, reflect:0, slow:0, assassin:false, targeting:'fighter', attackType:'melee', engageRange:36, baseEngageRange:36, tags:['ground','melee','special'], dodgeChance:0.3, collection:'animals', tip:'30% dodge chance makes it infuriating to kill. Very fragile if the dodge fails.' },
  { id:'tortoise', name:'Tortoise', icon:'🐢', cost:2, hp:105, dmg:6, spd:22, atkRate:1.9, lane:'ground', ranged:false, healer:false, aoe:0, canAir:false, trample:false, phoenix:false, regen:0, reflect:-35, slow:0, assassin:false, targeting:'fighter', attackType:'melee', engageRange:36, baseEngageRange:36, tags:['ground','melee','special'], shellBlock:0.35, collection:'animals', tip:'Shell absorbs 35% of all incoming damage. Slow but nearly unkillable wall unit.' },
  { id:'eagle', name:'Eagle', icon:'🦅', cost:2, hp:33, dmg:13, spd:100, atkRate:1.8, lane:'air', ranged:false, healer:false, aoe:0, canAir:true, trample:false, phoenix:false, regen:0, reflect:0, slow:0, assassin:false, targeting:'fighter', attackType:'melee', engageRange:30, baseEngageRange:30, tags:['flying','melee','special'], eagleDive:true, groundDiveLag:true, collection:'animals', tip:'Flying melee that dives for 2× first-hit damage, then retreats 80px to reset the dive.' },
  { id:'bee', name:'Bee', icon:'🐝', cost:2, hp:29, dmg:6, spd:95, atkRate:1.2, lane:'air', ranged:true, healer:false, aoe:0, canAir:true, trample:false, phoenix:false, regen:0, reflect:0, slow:0, assassin:false, targeting:'fighter', attackType:'ranged', engageRange:100, baseEngageRange:100, tags:['flying','ranged','special'], beeSwarm:true, swarmDmg:4, swarmDur:6, collection:'animals', tip:'Flying ranged. On hit applies a bee swarm — 4 dmg/s for 6s. Stack multiple bees for overlapping swarms.' },
  { id:'bat', name:'Bat', icon:'🦇', cost:2, hp:39, dmg:9, spd:100, atkRate:0.9, lane:'air', ranged:false, healer:false, aoe:0, canAir:true, trample:false, phoenix:false, regen:0, reflect:0, slow:0, assassin:false, targeting:'fighter', attackType:'melee', engageRange:36, baseEngageRange:36, tags:['flying','melee','special'], echolocation:true, collection:'animals', tip:'Echolocation reveals all camouflaged enemies within 150px. Hard counter to Chameleon.' },
  { id:'kangaroo', name:'Kangaroo', icon:'🦘', cost:2, hp:58, dmg:21, spd:75, atkRate:1.5, lane:'ground', ranged:false, healer:false, aoe:0, canAir:false, trample:false, phoenix:false, regen:0, reflect:0, slow:0, assassin:false, targeting:'fighter', attackType:'melee', engageRange:36, baseEngageRange:36, tags:['ground','melee','special'], jumpAttack:true, jumpCooldown:4, collection:'animals', tip:'Leaps 55px toward the farthest enemy every 4s, resetting attack cooldown on landing.' },
  { id:'viper', name:'Viper', icon:'🐍', cost:3, hp:62, dmg:14, spd:60, atkRate:0.8, lane:'ground', ranged:true, healer:false, aoe:0, canAir:false, trample:false, phoenix:false, regen:0, reflect:0, slow:0, assassin:false, targeting:'fighter', attackType:'ranged', engageRange:140, baseEngageRange:140, tags:['ground','ranged','special'], poisonDmg:3, poisonDur:5, collection:'animals', tip:'Ranged with 140px range. Injects venom on hit — 3 dmg/s for 5s. Effective vs high-HP tanks.' },
  { id:'bear', name:'Bear', icon:'🐻', cost:3, hp:140, dmg:18, spd:50, atkRate:1.2, lane:'ground', ranged:false, healer:false, aoe:0, canAir:false, trample:false, phoenix:false, regen:0, reflect:0, slow:0, assassin:false, targeting:'fighter', attackType:'melee', engageRange:36, baseEngageRange:36, tags:['ground','melee','special'], bearRage:true, collection:'animals', tip:'Below 50% HP enters rage — permanent +10 damage and glowing aura. Very hard to burst down before the trigger.' },
  { id:'chameleon', name:'Chameleon', icon:'🦎', cost:3, hp:75, dmg:22, spd:65, atkRate:1.3, lane:'ground', ranged:false, healer:false, aoe:0, canAir:false, trample:false, phoenix:false, regen:0, reflect:0, slow:0, assassin:false, targeting:'fighter', attackType:'melee', engageRange:36, baseEngageRange:36, tags:['ground','melee','special'], camoCycle:7, camoDur:4, collection:'animals', tip:'Vanishes every 7s for 4s — invisible units cannot be targeted. Forces enemies to attack other units.' },
  { id:'jellyfish', name:'Jellyfish', icon:'🪼', cost:3, hp:44, dmg:14, spd:35, atkRate:2.0, lane:'air', ranged:true, healer:false, aoe:55, canAir:true, trample:false, phoenix:false, regen:0, reflect:0, slow:0, assassin:false, targeting:'fighter', attackType:'ranged', engageRange:160, baseEngageRange:160, tags:['flying','ranged','aoe','special'], electricPulse:true, collection:'animals', tip:'Flying AoE ranged. Electric pulse hits both lanes simultaneously. Ideal when enemies split between sky and ground.' },
  { id:'mantisshrimp', name:'Mantis Shrimp', icon:'🦐', cost:3, hp:69, dmg:24, spd:58, atkRate:0.7, lane:'ground', ranged:false, healer:false, aoe:0, canAir:false, trample:false, phoenix:false, regen:0, reflect:0, slow:0, assassin:false, targeting:'fighter', attackType:'melee', engageRange:36, baseEngageRange:36, tags:['ground','melee','special'], punchStun:true, punchStunEvery:3, punchStunDur:0.6, collection:'animals', tip:'Every 3rd hit is a power strike — 2× damage + stun + knockback. Snowballs against slow attackers.' },
  { id:'scorpion', name:'Scorpion', icon:'🦂', cost:3, hp:81, dmg:20, spd:71, atkRate:0.7, lane:'ground', ranged:false, healer:false, aoe:0, canAir:false, trample:false, phoenix:false, regen:0, reflect:0, slow:1.5, assassin:false, targeting:'fighter', attackType:'melee', engageRange:36, baseEngageRange:36, tags:['ground','melee','special'], poisonDmg:2, poisonDur:8, slowOnHit:1.5, collection:'animals', tip:'Each hit applies venom (2 dmg/s, 8s) and slows target by 50% for 1.5s. Great at stall-and-kill tactics.' },
  { id:'skunk', name:'Skunk', icon:'🦨', cost:3, hp:94, dmg:11, spd:48, atkRate:1.8, lane:'ground', ranged:false, healer:false, aoe:0, canAir:false, trample:false, phoenix:false, regen:0, reflect:0, slow:0, assassin:false, targeting:'fighter', attackType:'melee', engageRange:36, baseEngageRange:36, tags:['ground','melee','aoe','special'], stinkCloud:true, stinkCooldown:6, stinkRadius:85, stinkDmgReduction:0.3, stinkDmgPerSec:3, stinkAtkSlow:0.5, stinkHitsFlying:true, collection:'animals', tip:'Releases stink gas every 6s. Enemies in the cloud take DoT, deal -30% damage and attack 50% slower. Gas drifts to the sky lane too.' },
  { id:'zebra', name:'Zebra', icon:'🦓', cost:3, hp:133, dmg:14, spd:80, atkRate:1.4, lane:'ground', ranged:false, healer:false, aoe:0, canAir:false, trample:false, phoenix:false, regen:0, reflect:0, slow:0, assassin:false, targeting:'fighter', attackType:'melee', engageRange:36, baseEngageRange:36, tags:['ground','melee','special'], speedBoost:true, speedBoostAmt:1.3, speedBoostCooldown:8, speedBoostRadius:90, speedBoostDur:5, collection:'animals', tip:'Stampede boosts all nearby allies +30% speed for 5s every 8s. Pairs perfectly with slow heavy hitters.' },
  { id:'rhino', name:'Rhino', icon:'🦏', cost:4, hp:106, dmg:24, spd:100, atkRate:2.5, lane:'ground', ranged:false, healer:false, aoe:0, canAir:false, trample:false, phoenix:false, regen:0, reflect:0, slow:0, assassin:false, targeting:'rusher', attackType:'melee', engageRange:36, baseEngageRange:36, tags:['ground','melee','rusher','special'], chargeThrough:true, chargeKnockback:30, collection:'animals', tip:'Beelines to the enemy base, knocking back everything in its path for 60% damage. Best used to open a gap for slower units.' },
  { id:'crocodile', name:'Crocodile', icon:'🐊', cost:4, hp:103, dmg:27, spd:45, atkRate:0.8, lane:'ground', ranged:false, healer:false, aoe:0, canAir:false, trample:false, phoenix:false, regen:0, reflect:0, slow:0, assassin:false, targeting:'fighter', attackType:'melee', engageRange:36, baseEngageRange:36, tags:['ground','melee','special'], grabLock:true, grabDur:3.0, collection:'animals', tip:'Grabs a target and locks it in place for 3s — first bite deals 2× damage. Devastating vs a single high-value unit.' },
  { id:'giraffe', name:'Giraffe', icon:'🦒', cost:4, hp:106, dmg:20, spd:46, atkRate:1.3, lane:'ground', ranged:true, healer:false, aoe:0, canAir:true, trample:false, phoenix:false, regen:0, reflect:0, slow:0, assassin:false, targeting:'fighter', attackType:'ranged', engageRange:200, baseEngageRange:200, tags:['ground','ranged','special'], prioritiseAir:true, collection:'animals', tip:'Longest ranged unit (200px), prioritises flying targets. Safe backline sniper.' },
  { id:'tiger', name:'Tiger', icon:'🐅', cost:4, hp:102, dmg:24, spd:72, atkRate:0.8, lane:'ground', ranged:false, healer:false, aoe:0, canAir:false, trample:false, phoenix:false, regen:0, reflect:0, slow:0, assassin:false, targeting:'fighter', attackType:'melee', engageRange:36, baseEngageRange:36, tags:['ground','melee','special'], tigerRoar:true, roarCooldown:8, roarSilenceDur:3, collection:'animals', tip:'Roars every 8s — silences ALL enemies for 3s, preventing all abilities. Shuts down Genie, Angel, Shaman, Time Wizard simultaneously.' },
  { id:'gorilla', name:'Gorilla', icon:'🦍', cost:4, hp:161, dmg:28, spd:65, atkRate:1.3, lane:'ground', ranged:false, healer:false, aoe:0, canAir:false, trample:false, phoenix:false, regen:0, reflect:0, slow:0, assassin:false, targeting:'fighter', attackType:'melee', engageRange:36, baseEngageRange:36, tags:['ground','melee','special'], gorillaRage:true, collection:'animals', tip:'Below 50% HP flips to ranged mode (150px) and gains hit-flying. Starts as a melee wall then becomes a ranged threat.' },
  { id:'shark', name:'Shark', icon:'🦈', cost:5, hp:105, dmg:30, spd:68, atkRate:1.2, lane:'air', ranged:false, healer:false, aoe:0, canAir:true, trample:false, phoenix:false, regen:0, reflect:0, slow:0, assassin:false, targeting:'fighter', attackType:'melee', engageRange:36, baseEngageRange:36, tags:['flying','melee','special'], sharkPrey:true, collection:'animals', tip:'Flying melee that marks prey. Each time prey dies: permanently +7 HP, +2 dmg, +7 spd. Gets scarier the longer it survives.' },
  { id:'elephant', name:'Elephant', icon:'🐘', cost:5, hp:254, dmg:24, spd:37, atkRate:1.8, lane:'ground', ranged:false, healer:false, aoe:50, canAir:false, trample:false, phoenix:false, regen:0, reflect:0, slow:0, assassin:false, targeting:'fighter', attackType:'melee', engageRange:36, baseEngageRange:36, tags:['ground','melee','aoe','special'], trumpetCooldown:8, trumpetRadius:90, stunDur:1.5, collection:'animals', tip:'Trumpets every 8s — stuns all nearby enemies for 1.5s. Melee AoE with massive HP. Anchors any ground formation.' },
  { id:'whale', name:'Whale', icon:'🐋', cost:6, hp:314, dmg:20, spd:25, atkRate:2.1, lane:'air', ranged:true, healer:false, aoe:50, canAir:true, trample:false, phoenix:false, regen:0, reflect:0, slow:0, assassin:false, targeting:'fighter', attackType:'ranged', engageRange:160, baseEngageRange:160, tags:['flying','ranged','aoe','special'], tidalWave:true, waveRadius:140, waveCooldown:7, waveDmg:28, waveForward:true, collection:'animals', tip:'Flying AoE ranged. Tidal wave every 7s hits the frontmost unit in each lane for 28 damage + knockback. Dominant air lane anchor.' },
]);

export const WARFRONT_UNITS = WARFRONT_FANTASY_UNITS;

export const WARFRONT_COLLECTIONS = Object.freeze({
  fantasy: WARFRONT_FANTASY_UNITS,
  animals: WARFRONT_ANIMAL_UNITS,
});

export function getWarfrontUnits(collection = 'fantasy') {
  return WARFRONT_COLLECTIONS[collection] ?? WARFRONT_FANTASY_UNITS;
}

// ── 12-unit rotation ────────────────────────────────────────────────────────
const ROTATION_EPOCH = 1767225600000; // 2026-01-01T00:00:00Z
const ROTATION_PERIOD_MS = 3600000;   // 1 hour
const ACTIVE_POOL_SIZE = 12;
// game_pool() has 12 entries; warfront is at 0-based index 11.
// It stays active for 6 slots (k=5 freshest → k=0).
// Generation = which active window warfront is in; changes every 12h when warfront enters rotation.
const GAME_POOL_N = 12;
const WF_GAME_IDX = 11; // 0-based position of warfront in game_pool()

function seededShuffle(arr, seed) {
  const result = [...arr];
  let s = seed & 0xffffffff;
  for (let i = result.length - 1; i > 0; i--) {
    s = Math.imul(s, 1664525) + 1013904223 | 0;
    const j = (s >>> 0) % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function getActiveWarfrontPool(collection = 'fantasy') {
  const units = WARFRONT_COLLECTIONS[collection] ?? WARFRONT_FANTASY_UNITS;
  const hIndex = Math.floor((Date.now() - ROTATION_EPOCH) / ROTATION_PERIOD_MS);
  // generation increments each time warfront enters a new active window (~every 12h)
  const generation = Math.floor((hIndex - (WF_GAME_IDX + 5)) / GAME_POOL_N);
  const collSeed = collection === 'animals' ? 0x5a5a5a5a : 0xa5a5a5a5;
  const shuffledIds = seededShuffle(units.map(u => u.id), generation ^ collSeed);
  return shuffledIds.slice(0, Math.min(ACTIVE_POOL_SIZE, units.length));
}

export function getActiveDraftUnits(collection = 'fantasy') {
  const pool = new Set(getActiveWarfrontPool(collection));
  return getWarfrontUnits(collection)
    .filter(u => pool.has(u.id))
    .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
}

export const DIFF_TABLE = Object.freeze([
  { budget:11, name:'Easy',       mult:1.2 },
  { budget:12, name:'Normal',     mult:1.5 },
  { budget:13, name:'Hard',       mult:2.0 },
  { budget:14, name:'Brutal',     mult:3.0 },
  { budget:15, name:'Legendary',  mult:5.0 },
  { budget:16, name:'Impossible', mult:10.0 },
]);

export function getUnitById(id) {
  return WARFRONT_FANTASY_UNITS.find(u => u.id === id) || WARFRONT_ANIMAL_UNITS.find(u => u.id === id);
}

export async function playWarfront(bet, picks, collection = 'fantasy') {
  const { data, error } = await supabase.rpc('play_warfront', {
    p_bet: bet,
    p_picks: picks,
    p_collection: collection,
    p_draft_budget: 10,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    gameId: row.game_id,
    enemyArmy: row.enemy_army ?? [],
    enemyDifficulty: row.enemy_difficulty,
    enemyBudget: row.enemy_budget,
  };
}

/** Fetch admin pool/stat overrides. Returns empty overrides on any error (non-blocking). */
export async function fetchWarfrontOverrides() {
  try {
    const { data, error } = await supabase.rpc('get_warfront_overrides');
    if (error) throw error;
    return {
      fantasyPool:  data?.fantasy_pool  ?? null,
      animalPool:   data?.animal_pool   ?? null,
      fantasyStats: data?.fantasy_stats ?? {},
      animalStats:  data?.animal_stats  ?? {},
    };
  } catch {
    return { fantasyPool: null, animalPool: null, fantasyStats: {}, animalStats: {} };
  }
}

/** Return a copy of `units` with any stat fields in `statsObj[unit.id]` applied. */
export function applyStatOverrides(units, statsObj) {
  if (!statsObj || !Object.keys(statsObj).length) return units;
  return units.map((u) => {
    const ovr = statsObj[u.id];
    return ovr ? { ...u, ...ovr } : u;
  });
}

export async function resolveWarfront(gameId, playerBaseHp, enemyBaseHp) {
  const { data, error } = await supabase.rpc('resolve_warfront', {
    p_game_id: gameId,
    p_player_base_hp: playerBaseHp,
    p_enemy_base_hp: enemyBaseHp,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    newBalance: row.new_balance,
    multiplier: Number(row.multiplier),
    payout: row.payout,
    won: row.won,
  };
}
