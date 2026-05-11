#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// WARFRONT BATTLE SIMULATOR v2
// Optimised for speed: ~10 minutes for full team sweep on M4 Pro
//
// Key optimisations vs v1:
//   1. Inlined battle engine — no function calls inside hot loop
//   2. Typed arrays for fighter state (Float64Array) — CPU cache friendly
//   3. Adaptive battle counts per tier — fewer battles where outcome is clear
//   4. Early pruning — skip tiers if team is clearly outclassed
//   5. Stratified team sampling — ensures coverage of all archetypes
//   6. Smaller task chunks (20) for real-time progress streaming
//   7. Full-fidelity re-run only on top 200 teams
//   8. HTML report generated after simulation
//
// Usage:
//   node warfront_sim2.js --team footman,footman,archer,mage,shaman
//   node warfront_sim2.js --team all --battles 300
//   node warfront_sim2.js --help
// ═══════════════════════════════════════════════════════════════════════════
'use strict';
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os   = require('os');
const fs   = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS & UNIT DEFS
// ─────────────────────────────────────────────────────────────────────────────
const LANE_W      = 680;
const MAX_SLOTS   = 6;
const BUDGET      = 10;
const BATTLE_SECS = 40;
const DT          = 1 / 30;       // logic hz
const TICKS       = Math.round(BATTLE_SECS / DT); // 1200 ticks per battle

// Fighter state indices (Float64Array layout — avoids object property lookup)
const X=0,HP=1,MAXHP=2,ATK_CD=3,SPD=4,DMG=5,ATK_RATE=6,
      ENGAGE=7,BASE_ENGAGE=8,TRAMPLED=9,RAGING=10,ORIG_SPD=11,
      SLOW_ACTIVE=12,SLOW_TIMER=13,VOID_TIMER=14,VOID_ACTIVE=15,
      TELE_TIMER=16,REZ_DONE=17,REGEN=18,HEAL_TIMER=19,
      HEAL_RANGE=20,REFLECT=21,SLOW_DUR=22,AIR_MULT=23,
      AOE_RADIUS=24,AOE_RESIST=25,CHAIN=26,VOID_CYCLE=27,VOID_DUR=28,
      AOE_SHIELD=29,COST=30;
const FSTATE = 31; // total floats per fighter

// Bitfield flags (stored separately as Int8Array for speed)
const F_ALIVE=0,F_ENEMY=1,F_AIR=2,F_MELEE=3,F_RANGED=4,F_RUSHER=5,
      F_SHAMAN=6,F_NECRO=7,F_SELF_DEST=8,F_PHOENIX=9,F_ASSASSIN=10,
      F_PRIORITISE_AIR=11,F_CAN_HIT_FLYING=12,F_SHADE=13,F_WARLORD=14,
      F_FOOTMAN=15,F_ARCHER=16,F_BRUTE=17,F_CAVALRY=18,F_VOIDWALK=19,
      F_GOBLIN=20;
const NFLAGS = 21;

const UNIT_DEFS = [
  { id:'peasant',     cost:1, hp:56,  dmg:3,  spd:52,  atkRate:1.4, aoeR:0,  lane:'ground', melee:true,  ranged:false, rusher:false, canHitFlying:false, prioritiseAir:false, engageR:36,  baseEngR:36,  aoeShield:1,  regenPerSec:0, healRange:0,   reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false },
  { id:'footman',     cost:1, hp:63,  dmg:6,  spd:43,  atkRate:1.2, aoeR:0,  lane:'ground', melee:true,  ranged:false, rusher:false, canHitFlying:false, prioritiseAir:false, engageR:36,  baseEngR:36,  aoeShield:0,  regenPerSec:0, healRange:0,   reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:true, isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false },
  { id:'bombgoblin',  cost:1, hp:43,  dmg:36, spd:100, atkRate:999, aoeR:54, lane:'ground', melee:true,  ranged:false, rusher:true,  canHitFlying:false, prioritiseAir:false, engageR:36,  baseEngR:36,  aoeShield:0,  regenPerSec:0, healRange:0,   reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:true, isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:true },
  { id:'archer',      cost:2, hp:29,  dmg:8,  spd:41,  atkRate:0.9, aoeR:0,  lane:'ground', melee:false, ranged:true,  rusher:false, canHitFlying:true,  prioritiseAir:true,  engageR:151, baseEngR:151, aoeShield:0,  regenPerSec:0, healRange:0,   reflectPct:0,    slowDur:0,   airMult:2, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:true, isBrute:false,isCav:false,isVoid:false,isGoblin:false },
  { id:'assassin',    cost:2, hp:53,  dmg:24, spd:68,  atkRate:1.4, aoeR:0,  lane:'ground', melee:true,  ranged:false, rusher:false, canHitFlying:false, prioritiseAir:false, engageR:36,  baseEngR:36,  aoeShield:0,  regenPerSec:0, healRange:0,   reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:true, isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false },
  { id:'shaman',      cost:2, hp:44,  dmg:0,  spd:45,  atkRate:999, aoeR:0,  lane:'ground', melee:false, ranged:true,  rusher:false, canHitFlying:false, prioritiseAir:false, engageR:200, baseEngR:200, aoeShield:0,  regenPerSec:0, healRange:120, reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:true, isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false },
  { id:'brute',       cost:3, hp:110, dmg:18, spd:60,  atkRate:0.9, aoeR:0,  lane:'ground', melee:true,  ranged:false, rusher:false, canHitFlying:false, prioritiseAir:false, engageR:36,  baseEngR:36,  aoeShield:0,  regenPerSec:0, healRange:0,   reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:true, isCav:false,isVoid:false,isGoblin:false },
  { id:'cavalry',     cost:3, hp:72,  dmg:29, spd:63,  atkRate:1.8, aoeR:0,  lane:'ground', melee:true,  ranged:false, rusher:true,  canHitFlying:false, prioritiseAir:false, engageR:36,  baseEngR:36,  aoeShield:0,  regenPerSec:0, healRange:0,   reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:true, isVoid:false,isGoblin:false },
  { id:'harpy', displayName:'Fairy', cost:3, hp:53,  dmg:9,   spd:89,  atkRate:1.3, aoeR:0,  lane:'air',    melee:true,  ranged:false, rusher:true,  canHitFlying:true,  prioritiseAir:false, engageR:36,  baseEngR:36,  aoeShield:0,  regenPerSec:0, healRange:0,   reflectPct:0,    slowDur:0,   airMult:1, aoeResist:0.5, chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false },
  { id:'troll',       cost:3, hp:154, dmg:13, spd:48,  atkRate:1.3, aoeR:0,  lane:'ground', melee:true,  ranged:false, rusher:false, canHitFlying:false, prioritiseAir:false, engageR:36,  baseEngR:36,  aoeShield:0,  regenPerSec:3, healRange:0,   reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false },
  { id:'voidwalker',  cost:3, hp:97,  dmg:20, spd:62,  atkRate:1.1, aoeR:0,  lane:'ground', melee:true,  ranged:false, rusher:false, canHitFlying:false, prioritiseAir:false, engageR:36,  baseEngR:36,  aoeShield:0,  regenPerSec:0, healRange:0,   reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:5, voidDur:1.5, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:true, isGoblin:false },
  { id:'frostwitch',  cost:4, hp:104, dmg:18, spd:44,  atkRate:1.6, aoeR:0,  lane:'ground', melee:false, ranged:true,  rusher:false, canHitFlying:true,  prioritiseAir:false, engageR:185, baseEngR:185, aoeShield:0,  regenPerSec:0, healRange:0,   reflectPct:0,    slowDur:2.0, frostSlowPct:0.7, airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false },
  { id:'mage',        cost:4, hp:48,  dmg:22, spd:42,  atkRate:1.6, aoeR:50, lane:'ground', melee:false, ranged:true,  rusher:false, canHitFlying:true,  prioritiseAir:true,  engageR:150, baseEngR:150, aoeShield:0,  regenPerSec:0, healRange:0,   reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false },
  { id:'mirrormage',  cost:4, hp:98,  dmg:16, spd:40,  atkRate:1.5, aoeR:0,  lane:'ground', melee:false, ranged:true,  rusher:false, canHitFlying:true,  prioritiseAir:false, engageR:140, baseEngR:140, aoeShield:0,  regenPerSec:0, healRange:0,   reflectPct:0.4,  slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, mirrorAll:true },
  { id:'necromancer', cost:4, hp:104, dmg:21, spd:35,  atkRate:1.9, aoeR:0,  lane:'ground', melee:false, ranged:true,  rusher:false, canHitFlying:false, prioritiseAir:false, engageR:140, baseEngR:140, aoeShield:0,  regenPerSec:0, healRange:0,   reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:true, isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false },
  { id:'phoenix',     cost:5, hp:66,  dmg:18, spd:66,  atkRate:1.4, aoeR:40, lane:'air',    melee:false, ranged:true,  rusher:false, canHitFlying:true,  prioritiseAir:false, engageR:140, baseEngR:140, aoeShield:0,  regenPerSec:0, healRange:0,   reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:true, isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false },
  { id:'warlord',     cost:5, hp:152, dmg:20, spd:38,  atkRate:1.1, aoeR:0,  lane:'ground', melee:true,  ranged:false, rusher:false, canHitFlying:false, prioritiseAir:false, engageR:36,  baseEngR:36,  aoeShield:0,  regenPerSec:0, healRange:0,   reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:true, isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false },
  { id:'siege',       cost:5, hp:55,  dmg:40, spd:27,  atkRate:2.1, aoeR:62, lane:'ground', melee:false, ranged:true,  rusher:false, canHitFlying:false, prioritiseAir:false, engageR:160, baseEngR:160, aoeShield:0,  regenPerSec:0, healRange:0,   reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false },
  { id:'stormdrake',  cost:5, hp:85,  dmg:19, spd:70,  atkRate:1.8, aoeR:0,  lane:'air',    melee:false, ranged:true,  rusher:false, canHitFlying:true,  prioritiseAir:false, engageR:160, baseEngR:160, aoeShield:0,  regenPerSec:0, healRange:0,   reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:3, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false },
  { id:'lumberjack',   cost:2, hp:68,  dmg:11, spd:65,  atkRate:0.6, aoeR:0,  lane:'ground', melee:true,  ranged:false, rusher:false, canHitFlying:false, prioritiseAir:false, engageR:36,  baseEngR:36,  aoeShield:0,  regenPerSec:0, healRange:0,   reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, lumberjackAxe:true },
  { id:'angel',        cost:2, hp:65,  dmg:0,  spd:60,  atkRate:999, aoeR:0,  lane:'air',    melee:false, ranged:false, rusher:false, canHitFlying:false, prioritiseAir:false, engageR:200, baseEngR:200, aoeShield:0,  regenPerSec:0, healRange:0,   reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, isAngel:true, angelCooldown:2 },
  { id:'genie',       cost:4, hp:174, dmg:17, spd:45,  atkRate:1.3, aoeR:0,  lane:'ground', melee:true,  ranged:false, rusher:false, canHitFlying:false, prioritiseAir:false, engageR:36,  baseEngR:36,  aoeShield:0,  regenPerSec:0, healRange:0,   reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false },
  { id:'timewizard',  cost:3, hp:118, dmg:16, spd:36,  atkRate:2.1, aoeR:0,  lane:'ground', melee:false, ranged:true,  rusher:false, canHitFlying:false, prioritiseAir:false, engageR:80,  baseEngR:80,  aoeShield:0,  regenPerSec:0, healRange:0,   reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false },
  { id:'golem',       cost:6, hp:351, dmg:32, spd:24,  atkRate:2.2, aoeR:42, lane:'ground', melee:true,  ranged:false, rusher:false, canHitFlying:false, prioritiseAir:false, engageR:36,  baseEngR:36,  aoeShield:0,  regenPerSec:0, healRange:0,   reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false },
];
const UNIT_MAP = Object.fromEntries(UNIT_DEFS.map(u=>[u.id,u]));

const ANIMAL_DEFS = [
  { id:'rat',          cost:1, hp:22,  dmg:7,  spd:97,  atkRate:0.3, aoeR:0,  lane:'ground', melee:true,  ranged:false, rusher:false, canHitFlying:false, prioritiseAir:false, engageR:36,  baseEngR:36,  aoeShield:0, regenPerSec:0, healRange:0,  reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, ratContaminate:true, contaminateDmg:10, contaminateDur:6, collection:'animals' },
  { id:'wolfpack',     cost:1, hp:16,  dmg:5,  spd:65,  atkRate:0.9, aoeR:0,  lane:'ground', melee:true,  ranged:false, rusher:false, canHitFlying:false, prioritiseAir:false, engageR:36,  baseEngR:36,  aoeShield:0, regenPerSec:0, healRange:0,  reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, twin:true, collection:'animals' },
  { id:'squirrel',     cost:1, hp:28,  dmg:7,  spd:90,  atkRate:0.8, aoeR:0,  lane:'ground', melee:true,  ranged:false, rusher:false, canHitFlying:false, prioritiseAir:false, engageR:36,  baseEngR:36,  aoeShield:0, regenPerSec:0, healRange:0,  reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, dodgeChance:0.3, collection:'animals' },
  { id:'tortoise',     cost:2, hp:105, dmg:6,  spd:22,  atkRate:1.9, aoeR:0,  lane:'ground', melee:true,  ranged:false, rusher:false, canHitFlying:false, prioritiseAir:false, engageR:36,  baseEngR:36,  aoeShield:0, regenPerSec:0, healRange:0,  reflectPct:-0.35,slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, shellBlock:0.35, collection:'animals' },
  { id:'eagle',        cost:2, hp:33,  dmg:13, spd:100, atkRate:1.8, aoeR:0,  lane:'air',    melee:true,  ranged:false, rusher:false, canHitFlying:true,  prioritiseAir:false, engageR:30,  baseEngR:30,  aoeShield:0, regenPerSec:0, healRange:0,  reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, eagleDive:true, groundDiveLag:true, collection:'animals' },
  { id:'bee',          cost:2, hp:29,  dmg:6,  spd:95,  atkRate:1.2, aoeR:0,  lane:'air',    melee:false, ranged:true,  rusher:false, canHitFlying:true,  prioritiseAir:false, engageR:100, baseEngR:100, aoeShield:0, regenPerSec:0, healRange:0,  reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, beeSwarm:true, swarmDmg:4, swarmDur:6, collection:'animals' },
  { id:'bat',          cost:2, hp:39,  dmg:9,  spd:100, atkRate:0.9, aoeR:0,  lane:'air',    melee:true,  ranged:false, rusher:false, canHitFlying:true,  prioritiseAir:false, engageR:36,  baseEngR:36,  aoeShield:0, regenPerSec:0, healRange:0,  reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, echolocation:true, collection:'animals' },
  { id:'kangaroo',     cost:2, hp:58,  dmg:21, spd:75,  atkRate:1.5, aoeR:0,  lane:'ground', melee:true,  ranged:false, rusher:false, canHitFlying:false, prioritiseAir:false, engageR:36,  baseEngR:36,  aoeShield:0, regenPerSec:0, healRange:0,  reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, jumpAttack:true, jumpCooldown:4, collection:'animals' },
  { id:'viper',        cost:3, hp:62,  dmg:14, spd:60,  atkRate:0.8, aoeR:0,  lane:'ground', melee:false, ranged:true,  rusher:false, canHitFlying:false, prioritiseAir:false, engageR:140, baseEngR:140, aoeShield:0, regenPerSec:0, healRange:0,  reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, poisonDmg:3, poisonDur:5, collection:'animals' },
  { id:'bear',         cost:3, hp:140, dmg:18, spd:50,  atkRate:1.2, aoeR:0,  lane:'ground', melee:true,  ranged:false, rusher:false, canHitFlying:false, prioritiseAir:false, engageR:36,  baseEngR:36,  aoeShield:0, regenPerSec:0, healRange:0,  reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, bearRage:true, collection:'animals' },
  { id:'chameleon',    cost:3, hp:75,  dmg:22, spd:65,  atkRate:1.3, aoeR:0,  lane:'ground', melee:true,  ranged:false, rusher:false, canHitFlying:false, prioritiseAir:false, engageR:36,  baseEngR:36,  aoeShield:0, regenPerSec:0, healRange:0,  reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, camoCycle:7, camoDur:4, collection:'animals' },
  { id:'jellyfish',    cost:3, hp:44,  dmg:14, spd:35,  atkRate:2.0, aoeR:55, lane:'air',    melee:false, ranged:true,  rusher:false, canHitFlying:true,  prioritiseAir:false, engageR:160, baseEngR:160, aoeShield:0, regenPerSec:0, healRange:0,  reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, electricPulse:true, collection:'animals' },
  { id:'mantisshrimp', cost:3, hp:69,  dmg:24, spd:58,  atkRate:0.7, aoeR:0,  lane:'ground', melee:true,  ranged:false, rusher:false, canHitFlying:false, prioritiseAir:false, engageR:36,  baseEngR:36,  aoeShield:0, regenPerSec:0, healRange:0,  reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, punchStun:true, punchStunEvery:3, punchStunDur:0.6, collection:'animals' },
  { id:'scorpion',     cost:3, hp:81,  dmg:20, spd:71,  atkRate:0.7, aoeR:0,  lane:'ground', melee:true,  ranged:false, rusher:false, canHitFlying:false, prioritiseAir:false, engageR:36,  baseEngR:36,  aoeShield:0, regenPerSec:0, healRange:0,  reflectPct:0,    slowDur:1.5, airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, poisonDmg:2, poisonDur:6, collection:'animals' },
  { id:'skunk',        cost:3, hp:94,  dmg:11, spd:48,  atkRate:1.8, aoeR:0,  lane:'ground', melee:true,  ranged:false, rusher:false, canHitFlying:false, prioritiseAir:false, engageR:36,  baseEngR:36,  aoeShield:0, regenPerSec:0, healRange:0,  reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, stinkCloud:true, stinkCooldown:6, stinkRadius:85, stinkDmgReduction:0.3, stinkDmgPerSec:3, stinkAtkSlow:0.5, stinkHitsFlying:true, collection:'animals' },
  { id:'zebra',        cost:3, hp:133, dmg:14, spd:80,  atkRate:1.4, aoeR:0,  lane:'ground', melee:true,  ranged:false, rusher:false, canHitFlying:false, prioritiseAir:false, engageR:36,  baseEngR:36,  aoeShield:0, regenPerSec:0, healRange:0,  reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, speedBoost:true, speedBoostAmt:1.3, speedBoostCooldown:8, speedBoostRadius:90, speedBoostDur:5, collection:'animals' },
  { id:'rhino',        cost:4, hp:106, dmg:24, spd:100, atkRate:2.5, aoeR:0,  lane:'ground', melee:true,  ranged:false, rusher:true,  canHitFlying:false, prioritiseAir:false, engageR:36,  baseEngR:36,  aoeShield:0, regenPerSec:0, healRange:0,  reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, chargeThrough:true, chargeKnockback:30, collection:'animals' },
  { id:'crocodile',    cost:4, hp:103, dmg:27, spd:45,  atkRate:0.8, aoeR:0,  lane:'ground', melee:true,  ranged:false, rusher:false, canHitFlying:false, prioritiseAir:false, engageR:36,  baseEngR:36,  aoeShield:0, regenPerSec:0, healRange:0,  reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, grabLock:true, grabDur:3.0, collection:'animals' },
  { id:'giraffe',      cost:4, hp:106, dmg:20, spd:46,  atkRate:1.4, aoeR:0,  lane:'ground', melee:false, ranged:true,  rusher:false, canHitFlying:true,  prioritiseAir:true,  engageR:200, baseEngR:200, aoeShield:0, regenPerSec:0, healRange:0,  reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, collection:'animals' },
  { id:'tiger',        cost:4, hp:102, dmg:24, spd:72,  atkRate:0.8, aoeR:0,  lane:'ground', melee:true,  ranged:false, rusher:false, canHitFlying:false, prioritiseAir:false, engageR:36,  baseEngR:36,  aoeShield:0, regenPerSec:0, healRange:0,  reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, tigerRoar:true, roarCooldown:8, roarSilenceDur:3, collection:'animals' },
  { id:'gorilla',      cost:4, hp:161, dmg:28, spd:65,  atkRate:1.3, aoeR:0,  lane:'ground', melee:true,  ranged:false, rusher:false, canHitFlying:false, prioritiseAir:false, engageR:36,  baseEngR:36,  aoeShield:0, regenPerSec:0, healRange:0,  reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, gorillaRage:true, collection:'animals' },
  { id:'shark',        cost:5, hp:108, dmg:31, spd:68,  atkRate:1.2, aoeR:0,  lane:'air',    melee:true,  ranged:false, rusher:false, canHitFlying:true,  prioritiseAir:false, engageR:36,  baseEngR:36,  aoeShield:0, regenPerSec:0, healRange:0,  reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, sharkPrey:true, collection:'animals' },
  { id:'elephant',     cost:5, hp:254, dmg:24, spd:37,  atkRate:1.8, aoeR:50, lane:'ground', melee:true,  ranged:false, rusher:false, canHitFlying:false, prioritiseAir:false, engageR:36,  baseEngR:36,  aoeShield:0, regenPerSec:0, healRange:0,  reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, trumpetCooldown:8, trumpetRadius:90, stunDur:1.5, collection:'animals' },
  { id:'whale',        cost:6, hp:314, dmg:20, spd:25,  atkRate:2.1, aoeR:50, lane:'air',    melee:false, ranged:true,  rusher:false, canHitFlying:true,  prioritiseAir:false, engageR:160, baseEngR:160, aoeShield:0, regenPerSec:0, healRange:0,  reflectPct:0,    slowDur:0,   airMult:1, aoeResist:1,   chain:0, voidCycle:0, voidDur:0, isSelf:false,isPx:false,isAss:false,isShaman:false,isNecro:false,isWarlord:false,isFootman:false,isArcher:false,isBrute:false,isCav:false,isVoid:false,isGoblin:false, tidalWave:true, waveRadius:140, waveCooldown:7, waveDmg:28, waveForward:true, collection:'animals' },
];
const ANIMAL_MAP = Object.fromEntries(ANIMAL_DEFS.map(u=>[u.id,u]));

// Safe collection-aware lookup — try/catch handles TDZ for const ACTIVE_UNIT_MAP
function uLook(id){
  try{if(ACTIVE_UNIT_MAP&&ACTIVE_UNIT_MAP[id])return ACTIVE_UNIT_MAP[id];}catch(e){}
  if(ANIMAL_MAP&&ANIMAL_MAP[id])return ANIMAL_MAP[id];
  return UNIT_MAP[id]||{cost:0,id,lane:'ground',ranged:false,melee:true,spd:50,aoeR:0,isShaman:false,isNecro:false,isWarlord:false,canHitFlying:false};
}

function runBattleFast(pIds, eIds) {
  // Build typed arrays for all fighters
  const allDefs = [
    ...pIds.map((id,i)=>({...UNIT_MAP[id],isEnemy:false,idx:i})),
    ...eIds.map((id,i)=>({...UNIT_MAP[id],isEnemy:true,idx:i})),
  ];
  const N = allDefs.length;
  const S = new Float64Array(N * FSTATE);     // state floats
  const F = new Int8Array(N * NFLAGS);         // flag bits
  const id_arr = allDefs.map(d=>d.id);        // for shade lookup
  const lane_arr = allDefs.map(d=>d.lane==='air'?1:0); // 1=air

  // Initialise state
  const yBase = [10,24,38,52,66,80,94,108];
  let pCount=0, eCount=0;
  allDefs.forEach((d,i)=>{
    const b = i*FSTATE, bf = i*NFLAGS;
    const ySpread = d.isEnemy?1.0:1.0;
    const idx = d.isEnemy ? eCount++ : pCount++;
    const total = d.isEnemy ? eIds.length : pIds.length;
    const yFrac = total<=1?0.5:(idx/(total-1));
    S[b+X]          = d.isEnemy ? LANE_W-62 : 62;
    S[b+HP]         = d.hp;
    S[b+MAXHP]      = d.hp;
    S[b+ATK_CD]     = Math.random()*(d.atkRate===999?1:d.atkRate);
    S[b+SPD]        = d.spd;
    S[b+DMG]        = d.dmg;
    S[b+ATK_RATE]   = d.atkRate;
    S[b+ENGAGE]     = d.engageR;
    S[b+BASE_ENGAGE]= d.baseEngR;
    S[b+ORIG_SPD]   = d.spd;
    S[b+REGEN]      = d.regenPerSec||0;
    S[b+HEAL_RANGE] = d.healRange||0;
    S[b+REFLECT]    = d.reflectPct||0;
    S[b+SLOW_DUR]   = d.slowDur||0;
    S[b+AIR_MULT]   = d.airMult||1;
    S[b+AOE_RADIUS] = d.aoeR||0;
    S[b+AOE_RESIST] = d.aoeResist||1;
    S[b+CHAIN]      = d.chain||0;
    S[b+VOID_CYCLE] = d.voidCycle||999;
    S[b+VOID_DUR]   = d.voidDur||0;
    S[b+AOE_SHIELD] = d.aoeShield||0;
    S[b+COST]       = d.cost||0;
    S[b+TELE_TIMER] = Math.random()*2;
    S[b+VOID_TIMER] = Math.random()*(d.voidCycle||5);

    F[bf+F_ALIVE]          = 1;
    F[bf+F_ENEMY]          = d.isEnemy?1:0;
    F[bf+F_AIR]            = d.lane==='air'?1:0;
    F[bf+F_MELEE]          = d.melee?1:0;
    F[bf+F_RANGED]         = d.ranged?1:0;
    F[bf+F_RUSHER]         = d.rusher?1:0;
    F[bf+F_SHAMAN]         = d.isShaman?1:0;
    F[bf+F_NECRO]          = d.isNecro?1:0;
    F[bf+F_SELF_DEST]      = d.isSelf?1:0;
    F[bf+F_PHOENIX]        = d.isPx?1:0;
    F[bf+F_ASSASSIN]       = d.isAss?1:0;
    F[bf+F_PRIORITISE_AIR] = d.prioritiseAir?1:0;
    F[bf+F_CAN_HIT_FLYING] = d.canHitFlying?1:0;
    F[bf+F_SHADE]          = 0;
    F[bf+F_WARLORD]        = d.isWarlord?1:0;
    F[bf+F_FOOTMAN]        = d.isFootman?1:0;
    F[bf+F_ARCHER]         = d.isArcher?1:0;
    F[bf+F_BRUTE]          = d.isBrute?1:0;
    F[bf+F_CAVALRY]        = d.isCav?1:0;
    F[bf+F_VOIDWALK]       = d.isVoid?1:0;
    F[bf+F_GOBLIN]         = d.isGoblin?1:0;
  });

  let PHP=100, EHP=100;
  let maxN = N; // grows if shades are added

  // ── Main battle loop ─────────────────────────────────────
  for(let tick=0; tick<TICKS; tick++){
    // Check for warlord (cached per tick)
    let warlordAlive=0, footmanAlive=0;
    for(let i=0;i<maxN;i++){
      const bf=i*NFLAGS;
      if(F[bf+F_ALIVE]&&!F[bf+F_ENEMY]){
        if(F[bf+F_WARLORD]) warlordAlive=1;
        if(F[bf+F_FOOTMAN]) footmanAlive=1;
      }
    }

    for(let i=0;i<maxN;i++){
      const bf=i*NFLAGS, b=i*FSTATE;
      if(!F[bf+F_ALIVE]) continue;

      const isEnemy = F[bf+F_ENEMY];
      const dir = isEnemy ? -1 : 1;
      const oppBase = isEnemy ? 62 : LANE_W-62;
      S[b+ATK_CD] = Math.max(0, S[b+ATK_CD]-DT);

      // Slow timer
      if(S[b+SLOW_ACTIVE]>0){
        S[b+SLOW_TIMER]-=DT;
        if(S[b+SLOW_TIMER]<=0){ S[b+SLOW_ACTIVE]=0; S[b+SPD]=S[b+ORIG_SPD]; }
      }

      // Troll regen
      if(S[b+REGEN]>0) S[b+HP]=Math.min(S[b+MAXHP],S[b+HP]+S[b+REGEN]*DT);

      // Brute rage
      if(F[bf+F_BRUTE]&&!S[b+RAGING]&&S[b+HP]/S[b+MAXHP]<0.3){
        S[b+RAGING]=1; S[b+SPD]=S[b+ORIG_SPD]*1.5;
      }

      // Voidwalker
      if(F[bf+F_VOIDWALK]){
        S[b+VOID_TIMER]+=DT;
        if(!S[b+VOID_ACTIVE]&&S[b+VOID_TIMER]>=S[b+VOID_CYCLE]){
          S[b+VOID_ACTIVE]=1; S[b+VOID_TIMER]=0;
        }
        if(S[b+VOID_ACTIVE]&&S[b+VOID_TIMER]>=S[b+VOID_DUR]){
          S[b+VOID_ACTIVE]=0; S[b+VOID_TIMER]=0;
        }
        if(S[b+VOID_ACTIVE]) continue;
      }

      // Shaman heal
      if(F[bf+F_SHAMAN]){
        S[b+HEAL_TIMER]+=DT;
        if(S[b+HEAL_TIMER]>=1.5){
          S[b+HEAL_TIMER]=0;
          let shamanCnt=0, bestJ=-1, bestFrac=999;
          for(let j=0;j<maxN;j++){
            const jf=j*NFLAGS, jb=j*FSTATE;
            if(!F[jf+F_ALIVE]||F[jf+F_ENEMY]!==isEnemy||F[jf+F_SHAMAN]) continue;
            shamanCnt++;
            const dist=Math.abs(S[jb+X]-S[b+X]);
            if(dist<=(S[b+HEAL_RANGE]||120)){
              const frac=S[jb+HP]/S[jb+MAXHP];
              if(frac<bestFrac){bestFrac=frac;bestJ=j;}
            }
          }
          if(bestJ>=0){
            const jb=bestJ*FSTATE;
            S[jb+HP]=Math.min(S[jb+MAXHP],S[jb+HP]+8*Math.max(1,shamanCnt));
          }
        }
        // Shaman movement — follow neediest ally
        let needX=oppBase, needFrac=999;
        for(let j=0;j<maxN;j++){
          const jf=j*NFLAGS,jb=j*FSTATE;
          if(!F[jf+F_ALIVE]||F[jf+F_ENEMY]!==isEnemy||F[jf+F_SHAMAN]) continue;
          const frac=S[jb+HP]/S[jb+MAXHP];
          if(frac<needFrac){needFrac=frac;needX=S[jb+X];}
        }
        const trailDir=isEnemy?1:-1;
        let tgt=needX+trailDir*(S[b+HEAL_RANGE]*0.4||48);
        const mid=LANE_W*0.5;
        if(isEnemy) tgt=Math.max(mid,Math.min(LANE_W-62,tgt));
        else        tgt=Math.min(mid,Math.max(62,tgt));
        if(Math.abs(S[b+X]-tgt)>5) S[b+X]+=Math.sign(tgt-S[b+X])*S[b+SPD]*DT;
        S[b+X]=Math.max(62,Math.min(LANE_W-62,S[b+X]));
        continue;
      }

      const isAir = F[bf+F_AIR];

      // ── Bomb Goblin
      if(F[bf+F_GOBLIN]&&F[bf+F_SELF_DEST]){
        let cx=0,cnt=0;
        for(let j=0;j<maxN;j++){
          const jf=j*NFLAGS,jb=j*FSTATE;
          if(!F[jf+F_ALIVE]||F[jf+F_ENEMY]===isEnemy) continue;
          cx+=S[jb+X]; cnt++;
        }
        if(cnt>0){
          cx/=cnt;
          if(Math.abs(S[b+X]-cx)>S[b+ENGAGE]){ S[b+X]+=dir*S[b+SPD]*DT; }
          else{
            const rad=S[b+AOE_RADIUS];
            for(let j=0;j<maxN;j++){
              const jf=j*NFLAGS,jb=j*FSTATE;
              if(!F[jf+F_ALIVE]||F[jf+F_ENEMY]===isEnemy) continue;
              const d2=Math.abs(S[jb+X]-S[b+X]);
              if(d2<=rad){
                let hdmg=S[b+DMG]*(0.85+Math.random()*0.3)*(1-d2/rad*0.3)*S[jb+AOE_RESIST];
                if(!S[jb+AOE_SHIELD]){
                  // find peasant shield nearby
                  for(let k=0;k<maxN;k++){
                    const kf=k*NFLAGS,kb=k*FSTATE;
                    if(!F[kf+F_ALIVE]||F[kf+F_ENEMY]!==F[jf+F_ENEMY]||!S[kb+AOE_SHIELD]) continue;
                    if(Math.abs(S[kb+X]-S[jb+X])<=70){ applyDmg(k,hdmg*0.4,i); hdmg*=0.6; break; }
                  }
                }
                applyDmg(j,hdmg,i);
              }
            }
            F[bf+F_ALIVE]=0; continue;
          }
        } else {
          if(Math.abs(S[b+X]-oppBase)>S[b+BASE_ENGAGE]){ S[b+X]+=dir*S[b+SPD]*DT; }
          else{
            const d=Math.round(S[b+DMG]*0.7);
            if(isEnemy) PHP=Math.max(0,PHP-d); else EHP=Math.max(0,EHP-d);
            F[bf+F_ALIVE]=0; continue;
          }
        }
        S[b+X]=Math.max(62,Math.min(LANE_W-62,S[b+X]));
        continue;
      }

      // ── Rusher (cavalry, harpy)
      if(F[bf+F_RUSHER]){
        // Look for air foe to fight (harpy vs harpy)
        let hitAirFoe=false;
        if(isAir){
          let nearest=-1, nearDist=9999;
          for(let j=0;j<maxN;j++){
            const jf=j*NFLAGS,jb=j*FSTATE;
            if(!F[jf+F_ALIVE]||F[jf+F_ENEMY]===isEnemy||!F[jf+F_AIR]) continue;
            const d=Math.abs(S[jb+X]-S[b+X]);
            if(d<nearDist){nearDist=d;nearest=j;}
          }
          if(nearest>=0&&nearDist<=S[b+ENGAGE]){
            if(S[b+ATK_CD]<=0){
              S[b+ATK_CD]=S[b+ATK_RATE];
              applyDmg(nearest,S[b+DMG]*(0.85+Math.random()*0.3),i);
            }
            const jb=nearest*FSTATE;
            if(Math.abs(S[jb+X]-S[b+X])>4) S[b+X]+=Math.sign(S[jb+X]-S[b+X])*S[b+SPD]*DT*0.5;
            hitAirFoe=true;
          }
        }
        if(!hitAirFoe){
          if(Math.abs(S[b+X]-oppBase)>S[b+BASE_ENGAGE]){ S[b+X]+=dir*S[b+SPD]*DT; }
          else if(S[b+ATK_CD]<=0){
            S[b+ATK_CD]=S[b+ATK_RATE];
            let raw=S[b+DMG]*(0.85+Math.random()*0.3);
            if(F[bf+F_CAVALRY]&&!S[b+TRAMPLED]){raw*=2;S[b+TRAMPLED]=1;}
            const dmg=Math.round(raw);
            if(isEnemy) PHP=Math.max(0,PHP-dmg); else EHP=Math.max(0,EHP-dmg);
          }
        }
        S[b+X]=Math.max(62,Math.min(LANE_W-62,S[b+X]));
        continue;
      }

      // ── Assassin hops
      if(F[bf+F_ASSASSIN]){
        S[b+TELE_TIMER]+=DT;
        if(S[b+TELE_TIMER]>=0.8){
          S[b+TELE_TIMER]=0;
          // Find backline target
          let btJ=-1, btScore=isEnemy?9999:-9999;
          for(let j=0;j<maxN;j++){
            const jf=j*NFLAGS,jb=j*FSTATE;
            if(!F[jf+F_ALIVE]||F[jf+F_ENEMY]===isEnemy) continue;
            const isBack=F[jf+F_RANGED]||F[jf+F_SHAMAN];
            const score=S[jb+X];
            if(isBack){
              if(isEnemy&&score<btScore){btScore=score;btJ=j;}
              if(!isEnemy&&score>btScore){btScore=score;btJ=j;}
            }
          }
          if(btJ<0){
            // fallback: furthest back
            for(let j=0;j<maxN;j++){
              const jf=j*NFLAGS,jb=j*FSTATE;
              if(!F[jf+F_ALIVE]||F[jf+F_ENEMY]===isEnemy) continue;
              const score=S[jb+X];
              if(isEnemy&&score<btScore){btScore=score;btJ=j;}
              if(!isEnemy&&score>btScore){btScore=score;btJ=j;}
            }
          }
          if(btJ>=0){
            const jb=btJ*FSTATE;
            const dist=Math.abs(S[jb+X]-S[b+X]);
            if(dist>S[b+ENGAGE]+8){
              const hop=Math.min(85,dist-S[b+ENGAGE]);
              S[b+X]+=Math.sign(S[jb+X]-S[b+X])*hop;
              S[b+X]=Math.max(62,Math.min(LANE_W-62,S[b+X]));
              if(Math.abs(S[jb+X]-S[b+X])<=S[b+ENGAGE]) S[b+ATK_CD]=0;
            }
          }
        }
        // Fall through to fighter logic
      }

      // ── Fighter: find nearest valid target
      let tgtJ=-1, tgtDist=9999;
      for(let j=0;j<maxN;j++){
        const jf=j*NFLAGS,jb=j*FSTATE;
        if(!F[jf+F_ALIVE]||F[jf+F_ENEMY]===isEnemy) continue;
        // ground melee can't hit air
        if(F[jf+F_AIR]&&F[bf+F_MELEE]&&!isAir) continue;
        if(F[jf+F_AIR]&&!F[bf+F_CAN_HIT_FLYING]) continue;
        // prioritise air
        let dist=Math.abs(S[jb+X]-S[b+X]);
        if(F[bf+F_PRIORITISE_AIR]&&F[jf+F_AIR]) dist-=10000; // prefer air
        if(dist<tgtDist){tgtDist=dist;tgtJ=j;}
      }

      if(tgtJ>=0){
        const jb=tgtJ*FSTATE;
        const realDist=Math.abs(S[jb+X]-S[b+X]);
        if(realDist>S[b+ENGAGE]){
          S[b+X]+=Math.sign(S[jb+X]-S[b+X])*S[b+SPD]*DT;
        } else if(S[b+ATK_CD]<=0){
          S[b+ATK_CD]=S[b+ATK_RATE];
          let raw=S[b+DMG]*(0.85+Math.random()*0.3);
          // Warlord buff
          if(warlordAlive&&!isEnemy&&!isAir) raw*=1.4;
          // Archer bonuses
          if(F[bf+F_ARCHER]){
            const jf2=tgtJ*NFLAGS;
            if(F[jf2+F_AIR]) raw*=S[b+AIR_MULT];
            if(footmanAlive) raw*=1.15;
          }
          const rad=S[b+AOE_RADIUS];
          if(rad>0){
            // AoE attack
            for(let j=0;j<maxN;j++){
              const jf=j*NFLAGS,jb2=j*FSTATE;
              if(!F[jf+F_ALIVE]||F[jf+F_ENEMY]===isEnemy) continue;
              if(F[jf+F_AIR]&&!F[bf+F_CAN_HIT_FLYING]) continue;
              const d2=Math.abs(S[jb2+X]-S[jb+X]);
              if(d2<=rad){
                let hdmg=raw*(1-d2/rad*0.35)*S[jb2+AOE_RESIST];
                if(!S[jb2+AOE_SHIELD]){
                  for(let k=0;k<maxN;k++){
                    const kf=k*NFLAGS,kb=k*FSTATE;
                    if(!F[kf+F_ALIVE]||F[kf+F_ENEMY]!==F[jf+F_ENEMY]||!S[kb+AOE_SHIELD]) continue;
                    if(Math.abs(S[kb+X]-S[jb2+X])<=70){ applyDmg(k,hdmg*0.4,i); hdmg*=0.6; break; }
                  }
                }
                applyDmg(j,hdmg,i);
              }
            }
          } else if(S[b+CHAIN]>1){
            // Chain lightning
            applyDmg(tgtJ,raw,i);
            let chainDmg=raw*0.55, lastX=S[jb+X];
            const chained=new Set([tgtJ]);
            for(let c=1;c<S[b+CHAIN];c++){
              let nextJ=-1,nextD=9999;
              for(let j=0;j<maxN;j++){
                if(chained.has(j)) continue;
                const jf=j*NFLAGS,jb2=j*FSTATE;
                if(!F[jf+F_ALIVE]||F[jf+F_ENEMY]===isEnemy) continue;
                const d=Math.abs(S[jb2+X]-lastX); if(d<nextD){nextD=d;nextJ=j;}
              }
              if(nextJ<0) break;
              chained.add(nextJ);
              applyDmg(nextJ,chainDmg,i);
              lastX=S[nextJ*FSTATE+X];
              chainDmg*=0.55;
            }
          } else {
            applyDmg(tgtJ,raw,i);
          }
        }
      } else {
        // No targets — march to base
        if(Math.abs(S[b+X]-oppBase)>S[b+BASE_ENGAGE]){ S[b+X]+=dir*S[b+SPD]*DT; }
        else if(S[b+ATK_CD]<=0){
          S[b+ATK_CD]=S[b+ATK_RATE];
          let raw=S[b+DMG]*(warlordAlive&&!isEnemy&&!isAir?1.4:1)*(0.85+Math.random()*0.3);
          const dmg=Math.round(raw);
          if(isEnemy) PHP=Math.max(0,PHP-dmg); else EHP=Math.max(0,EHP-dmg);
        }
      }
      S[b+X]=Math.max(62,Math.min(LANE_W-62,S[b+X]));
    }

    if(PHP<=0||EHP<=0) break;
  }

  // Survivor count: player units still alive
  let playerSurvivors=0, playerTotal=0;
  for(let i=0;i<pIds.length;i++){
    playerTotal++;
    if(F[i*NFLAGS+F_ALIVE]&&!F[i*NFLAGS+F_SHADE]) playerSurvivors++;
  }
  // Approximate per-unit battle stats for the fast engine
  const battleStats={};
  const totalDmgDealt=100-Math.max(0,Math.round(EHP));
  const totalDmgTaken=100-Math.max(0,Math.round(PHP));
  const nP=pIds.length||1;
  pIds.forEach((id,i)=>{
    const d=UNIT_DEFS.find(u=>u.id===id)||{};
    const w=(d.dmg||10)/((pIds.reduce((s,pid)=>{const dd=UNIT_DEFS.find(u=>u.id===pid)||{};return s+(dd.dmg||10);},0))||1);
    if(!battleStats[id])battleStats[id]={dmgDealt:0,dmgTaken:0,support:0,disruption:0,abilityUses:0,baseDmg:0};
    battleStats[id].dmgDealt+=Math.round(w*totalDmgDealt*2.5);
    battleStats[id].dmgTaken+=Math.round(totalDmgTaken/nP);
    if(d.isShaman)battleStats[id].support+=12;
    if(d.isWarlord)battleStats[id].support+=Math.round(w*15);
  });
  return {
    win: PHP>0&&(EHP<=0||PHP>EHP),
    php: Math.max(0,Math.round(PHP)),
    ehp: Math.max(0,Math.round(EHP)),
    survivors: playerSurvivors,
    unitCount: playerTotal,
    survMap: {}, battleStats,
  };

  // ── Inline damage application ──────────────────────────────────────────────
  function applyDmg(j, rawDmg, attackerIdx) {
    const jf=j*NFLAGS, jb=j*FSTATE;
    if(!F[jf+F_ALIVE]) return;
    if(S[jb+VOID_ACTIVE]) return;
    const dmg=Math.max(1,Math.round(rawDmg));
    S[jb+HP]-=dmg;
    // Mirror reflect
    if(S[jb+REFLECT]>0&&attackerIdx>=0){
      const ab=attackerIdx*FSTATE;
      S[ab+HP]-=Math.max(1,Math.round(dmg*S[jb+REFLECT]));
      if(S[ab+HP]<=0) F[attackerIdx*NFLAGS+F_ALIVE]=0;
    }
    // Slow on hit (frostwitch)
    const attackerBf=attackerIdx*NFLAGS;
    if(attackerIdx>=0&&S[attackerIdx*FSTATE+SLOW_DUR]>0&&!S[jb+SLOW_ACTIVE]){
      S[jb+SLOW_ACTIVE]=1; S[jb+SLOW_TIMER]=S[attackerIdx*FSTATE+SLOW_DUR];
      S[jb+ORIG_SPD]=S[jb+SPD]; S[jb+SPD]*=0.5;
    }
    if(S[jb+HP]<=0){
      // Phoenix rez
      if(F[jf+F_PHOENIX]&&!S[jb+REZ_DONE]){ S[jb+REZ_DONE]=1; S[jb+HP]=Math.round(S[jb+MAXHP]*0.4); return; }
      F[jf+F_ALIVE]=0;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RANDOM ARMY BUILDER
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// ANIMAL BATTLE ENGINE (object-based — handles all animal specials)
// ─────────────────────────────────────────────────────────────────────────────
function runBattleAnimal(pIds,eIds){
  const allDefs=[...pIds.map((id,i)=>{const d=ANIMAL_MAP[id]||UNIT_MAP[id];return{...d,isEnemy:false,idx:i};}),
                 ...eIds.map((id,i)=>{const d=ANIMAL_MAP[id]||UNIT_MAP[id];return{...d,isEnemy:true,idx:i};})];
  const fighters=allDefs.map((d,i)=>({
    ...d,uid:d.id+(d.isEnemy?'e':'p')+i,
    currentHp:d.hp,maxHp:d.hp,alive:true,
    atkCooldown:Math.random()*(d.atkRate===999?1:d.atkRate),
    trampled:false,_rezDone:false,_slowTimer:0,_slowActive:false,
    _originalSpd:d.spd,_bearRaged:false,_camoTimer:Math.random()*(d.camoCycle||7),_camoActive:false,
    _trumpetTimer:Math.random()*(d.trumpetCooldown||8),_stunned:false,_stunTimer:0,
    _grabbed:false,_grabbing:false,_grabTimer:0,_grabTarget:null,_eagleDived:false,_retreating:false,_retreatDist:0,
    _poisoned:false,_poisonDmg:0,_poisonRemaining:0,_poisonTimer:0,
    _beeSwarm:false,_beeSwarmDmg:0,_beeSwarmRemain:0,_beeSwarmTimer:0,
    _punchCount:0,_pounceCount:0,_waveTimer:0,_jumpTimer:0,_stinked:false,_stinkTimer:0,_stinkMult:0,
    _punchCount:0,_pounceCount:0,_waveTimer:0,_jumpTimer:0,_stinked:false,_stinkTimer:0,_stinkMult:0,
    _voidTimer:0,_voidActive:false,_bruteRaged:false,
    x:d.isEnemy?LANE_W-62:62, y:20+Math.random()*60,
  }));
  // Handle twin spawning
  const toAdd=[];
  fighters.forEach(f=>{if(f.twin){toAdd.push({...f,uid:f.uid+'_b',x:f.isEnemy?LANE_W-72:72,y:f.y+20});}});
  fighters.push(...toAdd);

  let PHP=100,EHP=100;
  const isValid=(f,o)=>{
    if(o.isEnemy===f.isEnemy||!o.alive)return false;
    if(o._camoActive)return false;
    if(o._grabbed)return false;
    if(o.lane==='air'&&f.attackType==='melee'&&f.lane==='ground')return false;
    if(o.lane==='air'&&!f.canHitFlying)return false;
    return true;
  };
  const applyD=(att,tgt,raw,isBaseDmg=false)=>{
    if(!tgt.alive)return 0;
    // Squirrel dodge (30% chance)
    if(tgt.dodgeChance&&Math.random()<tgt.dodgeChance) return 0;
    if(tgt.shellBlock) raw*=(1-tgt.shellBlock);
    if(tgt.reflectPct<0) raw*=(1+tgt.reflectPct); // tortoise negative reflectPct = shellBlock
    if(att.eagleDive&&!att._eagleDived){att._eagleDived=true;raw*=2;}
    if(att.grabLock&&!att._grabbing&&!tgt._grabbed){att._grabbing=true;att._grabTimer=att.grabDur||3;att._grabTarget=tgt;tgt._grabbed=true;raw*=2;}
    if(att.poisonDmg&&!tgt._poisoned){tgt._poisoned=true;tgt._poisonDmg=att.poisonDmg;tgt._poisonRemaining=att.poisonDur||5;tgt._poisonTimer=0;}
    if(att.beeSwarm&&!tgt._beeSwarm){tgt._beeSwarm=true;tgt._beeSwarmDmg=att.swarmDmg||4;tgt._beeSwarmRemain=att.swarmDur||6;tgt._beeSwarmTimer=0;}
    if(att.lifeSteal&&att.alive){att.currentHp=Math.min(att.maxHp,att.currentHp+(att.lifeSteal||5));}
    // pounce removed — tiger now uses tigerRoar
    if(att.punchStun){att._punchCount=(att._punchCount||0)+1;if(att._punchCount>=(att.punchStunEvery||3)){att._punchCount=0;tgt._stunned=true;tgt._stunTimer=att.punchStunDur||0.6;}}
    if(tgt._stinked) raw*=(1-(tgt._stinkMult||0.3));
      if(att.lumberjackAxe&&att._lumberjackBonus) raw+=att._lumberjackBonus;
      if(att.slowOnHit&&!tgt._slowActive){tgt._slowActive=true;tgt._slowTimer=att.slowOnHit;tgt._originalSpd=tgt._originalSpd||tgt.spd;const sp2=att.frostSlowPct||0.5;tgt.spd=tgt._originalSpd*(1-sp2);att._statDisruption=(att._statDisruption||0)+1;}
    if(tgt.reflectPct>0&&att.alive){att.currentHp-=Math.max(1,Math.round(raw*tgt.reflectPct));if(att.currentHp<=0)att.alive=false;}
    const dmg=Math.max(1,Math.round(raw)); tgt.currentHp-=dmg;
    // Track stats
    if(att&&att.uid){att._statDmgDealt=(att._statDmgDealt||0)+dmg;}
    if(tgt&&tgt.uid){tgt._statDmgTaken=(tgt._statDmgTaken||0)+dmg;}
    if(isBaseDmg&&att&&att.uid){att._statBaseDmg=(att._statBaseDmg||0)+dmg;}
    if(tgt.currentHp<=0){if(tgt.phoenixRez&&!tgt._rezDone){tgt._rezDone=true;tgt.currentHp=Math.round(tgt.maxHp*0.4);return dmg;}tgt.alive=false;}
    return dmg;
  };
  for(let tick=0;tick<TICKS;tick++){
    const alive=fighters.filter(f=>f.alive);
    alive.forEach(f=>{
      f.atkCooldown=Math.max(0,f.atkCooldown-DT);
      if(f._slowActive){f._slowTimer-=DT;if(f._slowTimer<=0){f._slowActive=false;f.spd=f._originalSpd;}}
      if(f.regenPerSec>0)f.currentHp=Math.min(f.maxHp,f.currentHp+f.regenPerSec*DT);
      if(f.bearRage&&!f._bearRaged&&f.currentHp/f.maxHp<0.5){f._bearRaged=true;f.dmg+=10;}
      if(f.gorillaRage&&!f._gorillaRaged&&f.currentHp/f.maxHp<0.5){
        f._gorillaRaged=true;
        const gbDir=f.isEnemy?1:-1;
        f.x=Math.max(62,Math.min(LANE_W-62,f.x-gbDir*50));
        f.ranged=true; f.engageR=150; f.baseEngR=150; f.canHitFlying=true;
      }
      if(f.sharkPrey&&!f._preyInitDone){
        f._preyInitDone=true;
        const preyOpts=alive.filter(o=>o.isEnemy!==f.isEnemy);
        if(preyOpts.length){const p=preyOpts[Math.floor(Math.random()*preyOpts.length)];f._preyUid=p.uid;}
      }
      if(f.sharkPrey&&f._preyUid){
        const prevPrey=fighters.find(o=>o.uid===f._preyUid);
        if(!prevPrey||!prevPrey.alive){
          f._preyUid=null;
          f.dmg+=2;f.spd=Math.min(f.spd+7,250);f.currentHp=Math.min(f.maxHp,f.currentHp+7);
          const newPrey=alive.filter(o=>o.isEnemy!==f.isEnemy);
          if(newPrey.length)f._preyUid=newPrey[Math.floor(Math.random()*newPrey.length)].uid;
        }
      }
      // Lumberjack bonus
      if(f.lumberjackAxe)f._lumberjackBonus=alive.filter(o=>o.isEnemy!==f.isEnemy).length;
      // Golem fast follow-up — fires on next fighter iteration after the main hit
      if(f._golemFastPending&&f.alive&&f.aoeR>0){
        f._golemFastPending=false;
        const liveOpp2=alive.filter(o=>isValid(f,o));
        const ft2=liveOpp2.sort((a,b)=>Math.abs(a.x-f.x)-Math.abs(b.x-f.x))[0];
        if(ft2) liveOpp2.filter(o=>Math.abs(o.x-ft2.x)<=f.aoeR).forEach(t=>{applyD(f,t,f.dmg*(0.7+Math.random()*0.15));});
      }
      // Brute rage: below 30% HP, +50% speed (matches game)
      if(f.id==='brute'&&!f._bruteRaged&&f.currentHp/f.maxHp<0.3){f._bruteRaged=true;f.spd=(f._originalSpd||f.spd)*1.5;}
      // Tiger roar: silence all non-tiger enemies every roarCooldown seconds
      if(f.tigerRoar){
        f._roarTimer=(f._roarTimer||0)+DT;
        if(f._roarTimer>=(f.roarCooldown||8)){
          f._roarTimer=0; f._roaring=true; f._roarPhase=0.6;
          alive.filter(o=>o.isEnemy!==f.isEnemy&&o.id!=='tiger').forEach(t=>{
            t._silenced=true; t._silenceTimer=f.roarSilenceDur||3;
          });
        }
        if(f._roaring){f._roarPhase-=DT;if(f._roarPhase<=0)f._roaring=false;else return;}
      }
      if(f._silenced){f._silenceTimer-=DT;if(f._silenceTimer<=0)f._silenced=false;else return;} // silenced: skip movement+attack
      if(f._contaminated){f._contaminateTimer=(f._contaminateTimer||0)-DT;if(f._contaminateTimer<=0){f._contaminated=false;f.dmg+=Math.max(0,f._contaminateDmg||10);}}
      // Eagle dive land pause + retreat
      if(f._diveLanded){f._diveLandTimer=(f._diveLandTimer||0)-DT;if(f._diveLandTimer<=0){f._diveLanded=false;f._retreating=true;f._retreatDist=80;}}
      if(f._retreating){const step=f.spd*DT;f._retreatDist-=step;if(f._retreatDist<=0){f._retreating=false;f._eagleDived=false;}
        f.x=Math.max(62,Math.min(LANE_W-62,f.x-dir*step));return;}
      if(f.camoCycle){f._camoTimer=(f._camoTimer||0)+DT;f._camoActive=f._camoTimer%f.camoCycle<(f.camoDur||4);}
      // Voidwalker phase cycle: immune + can't act for voidDur every voidCycle
      if(f.voidCycle){
        f._voidTimer=(f._voidTimer||0)+DT;
        f._voidActive=(f._voidTimer%f.voidCycle)<(f.voidDur||1.5);
        if(f._voidActive) return; // phased out — skip all actions
      }
      if(f.trumpetCooldown){f._trumpetTimer=(f._trumpetTimer||0)+DT;if(f._trumpetTimer>=f.trumpetCooldown){f._trumpetTimer=0;alive.filter(o=>o.isEnemy!==f.isEnemy&&Math.abs(o.x-f.x)<=(f.trumpetRadius||90)).forEach(t=>{t._stunned=true;t._stunTimer=f.stunDur||1.5;});}}
      if(f._stunned){f._stunTimer-=DT;if(f._stunTimer<=0)f._stunned=false;else return;}
      if(f._grabbed){if(f._grabbing){f._grabTimer-=DT;if(f._grabTimer<=0||!f._grabTarget||!f._grabTarget.alive){f._grabbing=false;if(f._grabTarget){f._grabTarget._grabbed=false;f._grabTarget=null;}}}return;}
      if(f._poisoned){f._poisonTimer=(f._poisonTimer||0)+DT;if(f._poisonTimer>=1){f._poisonTimer=0;f.currentHp=Math.max(0,f.currentHp-(f._poisonDmg||3));if(f.currentHp<=0)f.alive=false;}f._poisonRemaining-=DT;if(f._poisonRemaining<=0)f._poisoned=false;}
      if(f._beeSwarm){f._beeSwarmTimer=(f._beeSwarmTimer||0)+DT;if(f._beeSwarmTimer>=0.5){f._beeSwarmTimer=0;f.currentHp=Math.max(0,f.currentHp-(f._beeSwarmDmg||4)*0.5);if(f.currentHp<=0)f.alive=false;}f._beeSwarmRemain=(f._beeSwarmRemain||0)-DT;if(f._beeSwarmRemain<=0)f._beeSwarm=false;}
      if(f.stinkCloud){f._stinkTimer=(f._stinkTimer||0)+DT;if(f._stinkTimer>=(f.stinkCooldown||6)){f._stinkTimer=0;const stinkHit=alive.filter(o=>{if(o.isEnemy===f.isEnemy)return false;const r=f.stinkRadius||85;return o.lane===f.lane?Math.abs(o.x-f.x)<=r:(f.stinkHitsFlying&&o.lane==='air'&&Math.abs(o.x-f.x)<=r*0.7);});
        stinkHit.forEach(t=>{t._stinked=true;t._stinkTimer=5.0;t._stinkMult=f.stinkDmgReduction||0.3;t._stinkDps=f.stinkDmgPerSec||0;if(!t._stinkAtkSlowed){t._stinkAtkSlowed=true;t.atkRate=t.atkRate*(1+(f.stinkAtkSlow||0.5));}});
        f._statDisruption=(f._statDisruption||0)+stinkHit.length; f._statAbilityUses=(f._statAbilityUses||0)+1;}}
      if(f._stinked){
        f._stinkTimer=(f._stinkTimer||0)-DT;
        // Scaling DoT: ramps up with exposure time (matches game)
        f._gasExposure=(f._gasExposure||0)+DT;
        const scaledDps=(f._stinkDps||0)*(1+Math.min(2,f._gasExposure*0.4));
        f._stinkDotAcc=(f._stinkDotAcc||0)+DT;
        if(f._stinkDotAcc>=0.5){f._stinkDotAcc=0;f.currentHp=Math.max(0,f.currentHp-scaledDps*0.5);if(f.currentHp<=0)f.alive=false;}
        if(f._stinkTimer<=0){f._stinked=false;f._gasExposure=0;if(f._stinkAtkSlowed){f._stinkAtkSlowed=false;f.atkRate=f._originalAtkRate||f.atkRate;}}
      }
      if(f.speedBoost){f._speedBoostTimer=(f._speedBoostTimer||0)+DT;if(f._speedBoostTimer>=(f.speedBoostCooldown||8)){f._speedBoostTimer=0;alive.filter(a=>a.isEnemy===f.isEnemy&&a!==f&&Math.abs(a.x-f.x)<=(f.speedBoostRadius||90)).forEach(a=>{if(!a._speedBoosted){a._speedBoosted=true;a._speedBoostRemain=f.speedBoostDur||5;a._originalSpd=a._originalSpd||a.spd;a.spd=a._originalSpd*(f.speedBoostAmt||1.3);}});}}
      if(f._speedBoosted){f._speedBoostRemain-=DT;if(f._speedBoostRemain<=0){f._speedBoosted=false;f.spd=f._originalSpd||f.spd;}}
      if(f.tidalWave){f._waveTimer=(f._waveTimer||0)+DT;if(f._waveTimer>=(f.waveCooldown||7)){f._waveTimer=0;
        ['ground','air'].forEach(lane=>{const inLane=alive.filter(o=>o.isEnemy!==f.isEnemy&&o.lane===lane);if(!inLane.length)return;const fwd=inLane.sort((a,b)=>f.isEnemy?(a.x-b.x):(b.x-a.x))[0];applyD(f,fwd,f.waveDmg||30);const pushDir=f.isEnemy?-1:1;fwd.x=Math.max(62,Math.min(LANE_W-62,fwd.x-pushDir*80));});}}
      if(f.jumpAttack){f._jumpTimer=(f._jumpTimer||0)+DT;if(f._jumpTimer>=(f.jumpCooldown||4)){f._jumpTimer=0;const opp2=alive.filter(o=>isValid(f,o)&&o.lane===f.lane);if(opp2.length){const bt=opp2.sort((a,b)=>f.isEnemy?(a.x-b.x):(b.x-a.x))[0];if(bt&&Math.abs(bt.x-f.x)>60){f.x=bt.x+(f.isEnemy?-40:40);f.x=Math.max(62,Math.min(LANE_W-62,f.x));f.atkCooldown=0;}}}}
      if(!f.alive) return;
      const dir=f.isEnemy?-1:1, oppBase=f.isEnemy?62:LANE_W-62;
      const opp=alive.filter(o=>isValid(f,o));
      // Rusher
      if(f.targeting==='rusher'||f.rusher||f.selfDestruct){
        // Bombgoblin (selfDestruct + aoeR): rush to nearest enemy cluster, then AoE explode
        if(f.selfDestruct&&f.aoeR>0){
          const inLane=opp.filter(o=>o.lane===f.lane);
          if(inLane.length){
            // Rush toward centroid of enemies
            const cx=inLane.reduce((s,t)=>s+t.x,0)/inLane.length;
            if(Math.abs(f.x-cx)>f.baseEngR){ f.x+=Math.sign(cx-f.x)*f.spd*DT; }
            else {
              // EXPLODE: AoE hit centred on self, hitting all enemies within aoeR
              inLane.filter(t=>Math.abs(t.x-f.x)<=f.aoeR).forEach(t=>{
                const d2=Math.abs(t.x-f.x);
                applyD(f,t,f.dmg*(0.85+Math.random()*0.3)*(1-d2/f.aoeR*0.3)*(t.aoeResist||1));
              });
              f.alive=false; // self-destruct
            }
          } else {
            // No enemies — rush base and explode on it
            if(Math.abs(f.x-oppBase)>f.baseEngR){ f.x+=dir*f.spd*DT; }
            else { const d=Math.round(f.dmg*0.7); if(f.isEnemy)PHP=Math.max(0,PHP-d);else EHP=Math.max(0,EHP-d); f.alive=false; }
          }
          f.x=Math.max(62,Math.min(LANE_W-62,f.x)); return;
        }
        // Rhino charge-through
        if(f.chargeThrough){const nx=f.x+dir*f.spd*DT;opp.filter(o=>o.lane===f.lane).forEach(t=>{const b=dir>0?(t.x>f.x&&t.x<=nx):(t.x<f.x&&t.x>=nx);if(b){applyD(f,t,f.dmg*0.6);const kbDir=t.isEnemy?1:-1;t.x=Math.max(62,Math.min(LANE_W-62,t.x+kbDir*(f.chargeKnockback||30)));f._statDisruption=(f._statDisruption||0)+1;}});}
        if(Math.abs(f.x-oppBase)>f.baseEngR){f.x+=dir*f.spd*DT;}
        else if(f.atkCooldown<=0){
          f.atkCooldown=f.atkRate;
          const raw=f.dmg*(0.85+Math.random()*0.3)*(f.id==='cavalry'&&!f.trampled?(f.trampled=true,2):1);
          const dmg=Math.round(raw);
          if(f.isEnemy)PHP=Math.max(0,PHP-dmg);else EHP=Math.max(0,EHP-dmg);
        }
        f.x=Math.max(62,Math.min(LANE_W-62,f.x));return;
      }
      // Target selection: prioritise air if flag set (e.g. archer)
      let tgt=null;
      if(opp.length){
        if(f.prioritiseAir){
          const airTargets=opp.filter(o=>o.lane==='air');
          tgt=airTargets.length?airTargets.sort((a,b)=>Math.abs(a.x-f.x)-Math.abs(b.x-f.x))[0]
                               :opp.sort((a,b)=>Math.abs(a.x-f.x)-Math.abs(b.x-f.x))[0];
        } else {
          tgt=opp.sort((a,b)=>Math.abs(a.x-f.x)-Math.abs(b.x-f.x))[0];
        }
      }
      if(tgt){
        if(Math.abs(tgt.x-f.x)>f.engageR){f.x+=Math.sign(tgt.x-f.x)*f.spd*DT;}
        else if(f.atkCooldown<=0&&!f._silenced){
          f.atkCooldown=f.atkRate;
          // Warlord buff: +20% dmg to all friendly ground units
          const warlordPresent=alive.some(a=>a.isEnemy===f.isEnemy&&a.id==='warlord'&&a.alive&&a.lane==='ground');
          const warlordMult=(warlordPresent&&f.lane==='ground'&&f.id!=='warlord')?1.4:1;
          let raw=f.dmg*(0.85+Math.random()*0.3)*warlordMult;
          // Golem double-strike: on alternate ticks fire a fast follow-up
          if(f.aoeR>0&&f.id==='golem'){
            // First hit (normal)
            opp.filter(o=>Math.abs(o.x-tgt.x)<=f.aoeR).forEach(t=>{
              let aoeRaw=raw*(1-Math.abs(t.x-tgt.x)/f.aoeR*0.35);
              const shielders=alive.filter(a=>a.isEnemy===t.isEnemy&&a.aoeShield&&Math.abs(a.x-t.x)<50);
              if(shielders.length) aoeRaw*=(1-shielders[0].aoeShield*0.4);
              applyD(f,t,aoeRaw);
            });
            // Schedule fast second hit on next eligible tick (0 delay in sim = same super-tick)
            f._golemFastPending=true;
          } else if(f.aoeR>0){opp.filter(o=>Math.abs(o.x-tgt.x)<=f.aoeR).forEach(t=>{
              let aoeRaw=raw*(1-Math.abs(t.x-tgt.x)/f.aoeR*0.35);
              // AoE shield: check if nearby allies can absorb some of the hit
              const shielders=alive.filter(a=>a.isEnemy===t.isEnemy&&a.aoeShield&&Math.abs(a.x-t.x)<50);
              if(shielders.length) aoeRaw*=(1-shielders[0].aoeShield*0.4); // absorb 40%
              applyD(f,t,aoeRaw);
            });
          } // end non-golem aoe
          else{
            // Apply air multiplier (archer 2× vs air targets)
            const airBonus=(f.airMult&&f.airMult>1&&tgt&&tgt.lane==='air')?f.airMult:1;
            applyD(f,tgt,raw*airBonus);
            // Mirror Mage: also hit all enemies of same type as primary target
            if(f.mirrorAll&&tgt&&tgt.id){
              alive.filter(o=>o.isEnemy!==f.isEnemy&&o.uid!==tgt.uid&&o.id===tgt.id&&o.alive)
                .forEach(m=>applyD(f,m,raw*0.85));
            }
          }
        }
      } else {
        if(Math.abs(f.x-oppBase)>f.baseEngR){f.x+=dir*f.spd*DT;}
        else if(f.atkCooldown<=0){f.atkCooldown=f.atkRate;const dmg=Math.round(f.dmg*(0.85+Math.random()*0.3));if(f.isEnemy)PHP=Math.max(0,PHP-dmg);else EHP=Math.max(0,EHP-dmg);}
      }
      f.x=Math.max(62,Math.min(LANE_W-62,f.x));
    });
    if(PHP<=0||EHP<=0)break;
    // Necromancer shade raising: for each newly dead friendly unit (no range limit, 50-70% stats)
    fighters.filter(f=>!f.isEnemy&&!f.alive&&!f._shadeMade&&!f.isShade).forEach(dead=>{
      const necros=fighters.filter(n=>n.id==='necromancer'&&n.alive);
      if(necros.length&&!dead._shadeMade){
        dead._shadeMade=true;
        // Find closest necromancer (either team), max 3 uses
        const bestNecro=necros.filter(n=>(n._necroUses||0)<3).sort((a,b)=>{
          const da=Math.abs(a.x-dead.x),db=Math.abs(b.x-dead.x);
          if(Math.abs(da-db)<10){
            if(a.isEnemy===dead.isEnemy&&b.isEnemy!==dead.isEnemy)return -1;
            if(b.isEnemy===dead.isEnemy&&a.isEnemy!==dead.isEnemy)return 1;
          }
          return da-db;
        })[0];
        if(!bestNecro)return;
        bestNecro._necroUses=(bestNecro._necroUses||0)+1;
        const pct=0.50; // always 50%
        const shadeHp=Math.max(30,Math.round((dead.maxHp||dead.hp||60)*pct));
        const shadeDmg=Math.max(8,Math.round((dead.dmg||10)*pct));
        const shadeSpd=Math.max(35,Math.round((dead.spd||50)*pct));
        const shade={
          id:'shade',uid:'shade_'+Math.random(),isEnemy:bestNecro.isEnemy,isShade:true,
          hp:shadeHp,maxHp:shadeHp,currentHp:shadeHp,dmg:shadeDmg,spd:shadeSpd,
          atkRate:1.2,engageR:36,baseEngR:36,lane:(dead.lane||'ground'),
          x:dead.x,y:dead.y,alive:true,atkCooldown:0.4,
          _slowActive:false,_slowTimer:0,_originalSpd:shadeSpd,
          _statDmgDealt:0,_statDmgTaken:0,dodgeChance:0,
        };
        fighters.push(shade);
      }
    });
  }
  const survMap={};
  pIds.forEach(id=>{if(!survMap[id])survMap[id]={s:0,t:0};survMap[id].t++;});
  fighters.filter(f=>!f.isEnemy&&f.alive&&!f.uid.endsWith('_b')).forEach(f=>{if(survMap[f.id])survMap[f.id].s++;});
  // Collect per-unit stat accumulators from this battle
  const battleStats={};
  fighters.forEach(f=>{
    if(!f.id||f.isShade) return;
    const key=f.id;
    if(!battleStats[key]) battleStats[key]={dmgDealt:0,dmgTaken:0,support:0,disruption:0,abilityUses:0,baseDmg:0};
    battleStats[key].dmgDealt+=(f._statDmgDealt||0);
    battleStats[key].dmgTaken+=(f._statDmgTaken||0);
    battleStats[key].support+=(f._statSupport||0);
    battleStats[key].disruption+=(f._statDisruption||0);
    battleStats[key].abilityUses+=(f._statAbilityUses||0);
    battleStats[key].baseDmg+=(f._statBaseDmg||0);
  });
  return{win:PHP>0&&(EHP<=0||PHP>EHP),php:Math.max(0,Math.round(PHP)),ehp:Math.max(0,Math.round(EHP)),survMap,battleStats};
}

// ─────────────────────────────────────────────────────────────────────────────
// UPDATED buildRandomArmy — uses passed pool
// ─────────────────────────────────────────────────────────────────────────────
function buildRandomArmy(budget, unitPool, playerTeam=[]) {
  // Build a random army with anti-mirror bias:
  // units the player has get 1/3 the probability weight of units they don't have.
  const pool=unitPool||UNIT_DEFS;
  const playerSet=new Set(playerTeam);
  const ids=[];
  let rem=budget, tries=0;
  while(rem>0&&tries<80&&ids.length<MAX_SLOTS){
    tries++;
    const available=pool.filter(u=>u.cost<=rem);
    if(!available.length) break;
    // Weighted pick: non-player units weight 3, player's units weight 1
    const weights=available.map(u=>playerSet.has(u.id)?1:3);
    const total=weights.reduce((a,b)=>a+b,0);
    let roll=Math.random()*total, pick=available[available.length-1];
    for(let i=0;i<available.length;i++){roll-=weights[i];if(roll<=0){pick=available[i];break;}}
    ids.push(pick.id); rem-=pick.cost;
  }
  return ids;
}

// ─────────────────────────────────────────────────────────────────────────────
// TEAM ENUMERATION — collection-aware
// ─────────────────────────────────────────────────────────────────────────────
function enumerateTeamsFrom(pool,budget=10,maxSlots=6){
  const ids=pool.map(u=>u.id);
  const costMap=Object.fromEntries(pool.map(u=>[u.id,u.cost]));
  const seen=new Set(); const teams=[];
  const minTeamCost=9; // only test teams with at least 9g spent
  function recurse(rem,slots,chosen){
    const spent=budget-rem;
    if(chosen.length>0&&spent>=minTeamCost){const key=[...chosen].sort().join(',');if(!seen.has(key)){seen.add(key);teams.push([...chosen].sort());}}
    if(slots>=maxSlots||rem<=0)return;
    for(const id of ids){const c=costMap[id];if(c<=rem)recurse(rem-c,slots+1,[...chosen,id]);}
  }
  recurse(budget,0,[]);
  return teams;
}

function stratifiedSample(teams,n,umap){
  const MAP=umap||UNIT_MAP;
  if(teams.length<=n)return teams;
  const bins=new Map();
  for(const t of teams){
    const cost=t.reduce((s,id)=>s+(MAP[id]?MAP[id].cost:0),0);
    const hasFly=t.some(id=>MAP[id]&&MAP[id].lane==='air');
    const hasRng=t.some(id=>MAP[id]&&MAP[id].ranged);
    const hasSupp=t.some(id=>MAP[id]&&(MAP[id].isShaman||MAP[id].isNecro));
    const key=`${cost}-${hasFly?1:0}-${hasRng?1:0}-${hasSupp?1:0}`;
    if(!bins.has(key))bins.set(key,[]);
    bins.get(key).push(t);
  }
  const result=[];
  const perBin=Math.ceil(n/bins.size);
  for(const bin of bins.values()){result.push(...bin.sort(()=>Math.random()-0.5).slice(0,perBin));}
  return result.sort(()=>Math.random()-0.5).slice(0,n);
}

// ─────────────────────────────────────────────────────────────────────────────
// WORKER MODE
// ─────────────────────────────────────────────────────────────────────────────
if(!isMainThread){
  // PvP worker mode
  if(workerData&&workerData.pvpTasks){
    const pvpPending=[];
    for(const{pvpA,pvpB,n,isAnimal} of workerData.pvpTasks){
      let aWins=0;
      for(let i=0;i<n;i++){
        try{
          const res=isAnimal?runBattleAnimal([...pvpA],[...pvpB]):runBattleFast([...pvpA],[...pvpB]);
          if(res.win) aWins++;
        }catch(e){}
      }
      pvpPending.push({teamA:pvpA,teamB:pvpB,aWon:aWins>n/2});
    }
    parentPort.postMessage({type:'pvpr',d:pvpPending});
    parentPort.postMessage({type:'done'});
    process.exit(0);
  }
  // Normal worker mode
  const{tasks}=workerData;
  const CHUNK=20; let pending=[];
  const flush=(force=false)=>{ if(pending.length>=CHUNK||force){parentPort.postMessage({type:'r',d:pending});pending=[];} };
  for(const task of tasks){
    const{playerTeam,enemyBudget,n,isAnimal}=task;
    let wins=0,losses=0,totalPhp=0,totalEhp=0,clutchWins=0,dominantWins=0;
    const survAcc={}, bStatsAcc={};
    for(let i=0;i<n;i++){
      try{
      const pool=isAnimal?ANIMAL_DEFS:UNIT_DEFS; const eIds=buildRandomArmy(enemyBudget,pool,playerTeam);
      const res=isAnimal?runBattleAnimal([...playerTeam],[...eIds]):runBattleFast([...playerTeam],[...eIds]);
      if(res.win){wins++;if(res.php<30)clutchWins++;else if(res.php>=70)dominantWins++;}
      else losses++;
      totalPhp+=res.php; totalEhp+=res.ehp;
      if(res.survMap)Object.entries(res.survMap).forEach(([uid,v])=>{if(!survAcc[uid])survAcc[uid]={s:0,t:0};survAcc[uid].s+=v.s;survAcc[uid].t+=v.t;});
      if(res.battleStats)Object.entries(res.battleStats).forEach(([id,bs])=>{
        if(!bStatsAcc[id]) bStatsAcc[id]={dmgDealt:0,dmgTaken:0,support:0,disruption:0,abilityUses:0,baseDmg:0,battles:0};
        bStatsAcc[id].dmgDealt+=bs.dmgDealt; bStatsAcc[id].dmgTaken+=bs.dmgTaken;
        bStatsAcc[id].support+=bs.support; bStatsAcc[id].disruption+=bs.disruption;
        bStatsAcc[id].abilityUses+=bs.abilityUses; bStatsAcc[id].baseDmg+=bs.baseDmg;
        bStatsAcc[id].battles++;
      });
      }catch(e){ /* skip failed battle */ }
    }
    pending.push({playerTeam,enemyBudget,wins,losses,totalPhp,totalEhp,survAcc,bStatsAcc,clutchWins,dominantWins});
    flush();
  }
  flush(true);
  parentPort.postMessage({type:'done'});
  process.exit(0);
}


// ─────────────────────────────────────────────────────────────────────────────
// MAIN THREAD INFRASTRUCTURE
// ─────────────────────────────────────────────────────────────────────────────
// os already declared at top
const args=process.argv.slice(2);
if(args.includes('--help')){
  process.stdout.write('\nWARFRONT SIMULATOR v2\n--team <ids|all>  --collection <fantasy|animals>  --battles <n>  --workers <n>  --out <file>\n\n');
  process.exit(0);
}
const getArg=(flag,def)=>{const i=args.indexOf(flag);return i!==-1?args[i+1]:def;};
const teamArg   = getArg('--team',null);
const battlesN  = parseInt(getArg('--battles','1000'));
const numWorkers= parseInt(getArg('--workers',String(Math.max(2,os.cpus().length))));
const colArg    = (getArg('--collection','fantasy')||'fantasy').toLowerCase();
const IS_ANIMAL = colArg==='animals';
const ACTIVE_UNIT_DEFS = IS_ANIMAL ? ANIMAL_DEFS : UNIT_DEFS;
const ACTIVE_UNIT_MAP  = IS_ANIMAL ? ANIMAL_MAP  : UNIT_MAP;
const pvpMode   = args.includes('--pvp'); // PvP: 10g teams vs each other (not vs enemies)
const pvpN      = parseInt(getArg('--pvp-battles','10')); // battles per matchup (best of N)
const outFile   = getArg('--out', IS_ANIMAL?'warfront_report_animals.html':'warfront_report_fantasy.html');
const ENEMY_BUDGETS=[11,12,13,14,15,16];

// Pass 1 battles per team per tier.
// The animals engine (runBattleAnimal) is ~4x slower than the fast fantasy engine.
// We give animals 4x fewer battles/team so total sim time stays comparable.
// Fantasy: ~9000 teams × 285 battles/team = 2.6M battles
// Animals: ~12000 teams × 75 battles/team = 0.9M battles → runs ~4x slower/battle = comparable
const ADAPTIVE_N = IS_ANIMAL
  ? {11:6,12:8,13:10,14:12,15:15,16:18}    // total 69/team — fast per-battle compensated
  : {11:25,12:30,13:40,14:50,15:60,16:80}; // total 285/team — fast typed-array engine
const P2N = IS_ANIMAL ? {11:80,12:80,13:80,14:80,15:80,16:80}       : {11:2000,12:2000,13:2000,14:2000,15:2000,16:2000};
const P3N = IS_ANIMAL ? {11:160,12:160,13:160,14:160,15:160,16:160} : {11:4000,12:4000,13:4000,14:4000,15:4000,16:4000};
const P4N = IS_ANIMAL ? {11:400,12:400,13:400,14:400,15:400,16:400} : {11:8000,12:8000,13:8000,14:8000,15:8000,16:8000};

// Team enumeration
function enumerateTeamsFrom(pool,budget=10,maxSlots=6){
  const ids=pool.map(u=>u.id);
  const costMap=Object.fromEntries(pool.map(u=>[u.id,u.cost]));
  const seen=new Set(); const teams=[];
  const minTeamCost=9; // only test teams with at least 9g spent
  function recurse(rem,slots,chosen){
    const spent=budget-rem;
    if(chosen.length>0&&spent>=minTeamCost){const key=[...chosen].sort().join(',');if(!seen.has(key)){seen.add(key);teams.push([...chosen].sort());}}
    if(slots>=maxSlots||rem<=0)return;
    for(const id of ids){const c=costMap[id];if(c<=rem)recurse(rem-c,slots+1,[...chosen,id]);}
  }
  recurse(budget,0,[]);
  return teams;
}

function stratifiedSample(teams,n,umap){
  const MAP=umap||UNIT_MAP;
  if(teams.length<=n)return teams;
  const bins=new Map();
  for(const t of teams){
    const cost=t.reduce((s,id)=>s+(MAP[id]?MAP[id].cost:0),0);
    const key=`${cost}-${t.some(id=>MAP[id]&&MAP[id].lane==='air')?1:0}-${t.some(id=>MAP[id]&&MAP[id].ranged)?1:0}`;
    if(!bins.has(key))bins.set(key,[]);
    bins.get(key).push(t);
  }
  const result=[];
  const perBin=Math.ceil(n/bins.size);
  for(const bin of bins.values()){result.push(...bin.sort(()=>Math.random()-0.5).slice(0,perBin));}
  return result.sort(()=>Math.random()-0.5).slice(0,n);
}

// Build teams to test
let teamsToTest=[]; let isFullSweep=false;
if(!teamArg||teamArg==='all'){
  isFullSweep=true;
  process.stdout.write('\uD83D\uDD0D Enumerating valid 10g '+colArg+' teams...\n');
  const all=enumerateTeamsFrom(ACTIVE_UNIT_DEFS,10,6);
  process.stdout.write('   Found '+all.length.toLocaleString()+' unique teams\n');
  // For animals: use all since there are fewer; for fantasy: sample 2000
  // Test ALL valid teams — no cap
  teamsToTest=all;
  process.stdout.write('   Testing: '+teamsToTest.length.toLocaleString()+' teams (all)\n');
} else {
  const ids=teamArg.split(',').map(s=>s.trim().toLowerCase());
  ids.forEach(id=>{if(!ACTIVE_UNIT_MAP[id]){process.stderr.write('Unknown unit: "'+id+'" in '+colArg+'\n');process.exit(1);}});
  const cost=ids.reduce((s,id)=>s+(ACTIVE_UNIT_MAP[id].cost||0),0);
  if(cost>10){process.stderr.write('Team cost '+cost+'g > 10g\n');process.exit(1);}
  teamsToTest=[ids];
}

const REFINE_PASSES=isFullSweep?[
  {topN:null,n:ADAPTIVE_N},{topN:100,n:P2N},{topN:50,n:P3N},{topN:10,n:P4N}
]:[{topN:null,n:{11:battlesN,12:battlesN,13:battlesN,14:battlesN,15:battlesN,16:battlesN}}];

const est=(()=>{
  if(!isFullSweep)return battlesN*6;
  return teamsToTest.length*Object.values(ADAPTIVE_N).reduce((s,v)=>s+v,0)
    +100*6*P2N[11]+50*6*P3N[11]+10*6*P4N[11];
})();
process.stdout.write('\n\u2694  WARFRONT SIMULATOR v2 -- collection: '+colArg+'\n');
process.stdout.write('   Teams: '+teamsToTest.length+'  Est battles: ~'+est.toLocaleString()+'  Workers: '+numWorkers+'\n');
if(isFullSweep){
  process.stdout.write('   Pass 1: '+teamsToTest.length+' teams x '+Object.values(ADAPTIVE_N).reduce((a,b)=>a+b,0)+'/team\n');
  process.stdout.write('   Pass 2: top 100 x '+P2N[11]+'/tier\n');
  process.stdout.write('   Pass 3: top 50 x '+P3N[11]+'/tier\n');
  process.stdout.write('   Pass 4: top 10 x '+P4N[11]+'/tier\n');
}
process.stdout.write('   Started: '+new Date().toLocaleTimeString()+'\n\n');
const t0=Date.now();

function chunk(arr,n){const c=Array.from({length:n},()=>[]);arr.forEach((x,i)=>c[i%n].push(x));return c;}

const teamResults=new Map();
let tasksDone=0,totalTasksAcrossPasses=0;

const updateResult=(res)=>{
  const key=[...res.playerTeam].sort().join(',');
  if(!teamResults.has(key)) teamResults.set(key,{
    team:res.playerTeam,wins:0,losses:0,totalPhp:0,totalEhp:0,
    clutchWins:0,dominantWins:0,byBudget:{},refinePasses:0,survAcc:{},bStatsAcc:{}
  });
  const tr=teamResults.get(key);
  tr.wins+=res.wins; tr.losses+=res.losses;
  tr.totalPhp+=res.totalPhp; tr.totalEhp+=res.totalEhp;
  tr.clutchWins+=(res.clutchWins||0);
  tr.dominantWins+=(res.dominantWins||0);
  if(!tr.byBudget[res.enemyBudget]) tr.byBudget[res.enemyBudget]={wins:0,losses:0};
  tr.byBudget[res.enemyBudget].wins+=res.wins;
  tr.byBudget[res.enemyBudget].losses+=res.losses;
  if(res.survAcc) Object.entries(res.survAcc).forEach(([uid,v])=>{
    if(!tr.survAcc[uid]) tr.survAcc[uid]={s:0,t:0};
    tr.survAcc[uid].s+=v.s; tr.survAcc[uid].t+=v.t;
  });
  if(res.bStatsAcc) Object.entries(res.bStatsAcc).forEach(([id,bs])=>{
    if(!tr.bStatsAcc) tr.bStatsAcc={};
    if(!tr.bStatsAcc[id]) tr.bStatsAcc[id]={dmgDealt:0,dmgTaken:0,support:0,disruption:0,abilityUses:0,baseDmg:0,battles:0};
    const t=tr.bStatsAcc[id];
    t.dmgDealt+=bs.dmgDealt; t.dmgTaken+=bs.dmgTaken;
    t.support+=bs.support; t.disruption+=bs.disruption;
    t.abilityUses+=bs.abilityUses; t.baseDmg+=bs.baseDmg;
    t.battles+=bs.battles;
  });
};

function runPass(teams,nPerTier,passLabel){
  const tasks=[];
  // Serialize unitPool inline so workers have it
  const serializedPool=ACTIVE_UNIT_DEFS.map(u=>({id:u.id,cost:u.cost,lane:u.lane,ranged:u.ranged,isShaman:u.isShaman}));
  for(const team of teams){
    for(const b of ENEMY_BUDGETS){
      const n=typeof nPerTier==='object'?nPerTier[b]:nPerTier;
      tasks.push({playerTeam:team,enemyBudget:b,n,
        unitPoolIds:ACTIVE_UNIT_DEFS.map(u=>u.id), // pass IDs only, worker looks up full def
        isAnimal:IS_ANIMAL});
    }
  }
  totalTasksAcrossPasses+=tasks.length;
  const passBattles=tasks.reduce((s,t)=>s+t.n,0);
  process.stdout.write('\n   -- '+passLabel+': '+teams.length+' teams, '+passBattles.toLocaleString()+' battles\n');
  const progInt=setInterval(()=>{
    const pct=((tasksDone/totalTasksAcrossPasses)*100).toFixed(1);
    const el=((Date.now()-t0)/1000).toFixed(1);
    const eta=tasksDone>0?((Date.now()-t0)/tasksDone*(totalTasksAcrossPasses-tasksDone)/1000).toFixed(0):'?';
    process.stdout.write('\r   '+tasksDone+'/'+totalTasksAcrossPasses+' tasks ('+pct+'%) -- '+el+'s elapsed, ETA ~'+eta+'s   ');
  },300);
  const ws=chunk(tasks,numWorkers);
  return Promise.all(ws.map(slice=>new Promise((resolve,reject)=>{
    const w=new Worker(__filename,{workerData:{tasks:slice}});
    w.on('message',msg=>{if(msg.type==='done'){resolve();return;}msg.d.forEach(res=>{updateResult(res);tasksDone++;});});
    w.on('error',reject);
  }))).then(()=>{clearInterval(progInt);process.stdout.write('\n');});
}

function currentSorted(){
  return [...teamResults.values()].sort((a,b)=>{
    const wa=a.wins/(a.wins+a.losses||1),wb=b.wins/(b.wins+b.losses||1);
    return wb-wa;
  });
}

function generatePvPReport({top100,playoff,allTeams,collection,outFile,unitPool,unitMapRef}){
  const fs=require('fs'),path=require('path');
  const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const pct=x=>(x*100).toFixed(1)+'%';
  const cc=v=>v>=0.55?'gr':v>=0.45?'ye':'re';
  const udn=id=>{const u=unitMapRef[id];return u?(u.displayName||u.id):id;};
  const uIcon=id=>{const u=unitMapRef[id];return u?(u.icon||''):'';};
  const teamStr=t=>t.map(id=>uIcon(id)+'\u200a'+udn(id)).join(', ');
  const cost=t=>t.reduce((s,id)=>s+(unitMapRef[id]?unitMapRef[id].cost:0),0);
  const medal=i=>i===0?'🥇':i===1?'🥈':i===2?'🥉':'#'+(i+1);

  // ── Unit stats from PvP data ──────────────────────────────────────────────
  const unitPvpStats={};
  (unitPool||[]).forEach(u=>{unitPvpStats[u.id]={wins:0,losses:0,apps:0};});
  top100.forEach(e=>{
    e.team.forEach(id=>{
      if(!unitPvpStats[id]) unitPvpStats[id]={wins:0,losses:0,apps:0};
      unitPvpStats[id].apps+=e.games;
      unitPvpStats[id].wins+=e.wins;
      unitPvpStats[id].losses+=e.losses;
    });
  });
  const unitPvpArr=Object.entries(unitPvpStats)
    .filter(([,v])=>v.apps>0)
    .map(([id,v])=>({id,wr:v.wins/v.apps,wins:v.wins,losses:v.losses,apps:v.apps}))
    .sort((a,b)=>b.wr-a.wr);

  // ── Build HTML sections ───────────────────────────────────────────────────
  // TOP 100 TABLE
  let top100Rows='';
  top100.forEach((e,i)=>{
    const cls=cc(e.wr);
    top100Rows+=`<tr>
      <td class="rk">${medal(i)}</td>
      <td class="${cls} fw-cell">${pct(e.wr)}</td>
      <td class="rec">${e.wins}W/${e.draws||0}D/${e.losses}L</td>
      <td class="gc">${cost(e.team)}g</td>
      <td class="team-cell">${esc(teamStr(e.team))}</td>
    </tr>`;
  });

  // PLAYOFF TABLE (top 16 round-robin results)
  let playoffRows='';
  playoff.forEach((e,i)=>{
    const cls=cc(e.wr);
    playoffRows+=`<tr>
      <td class="rk">${medal(i)}</td>
      <td class="${cls} fw-cell">${pct(e.wr)}</td>
      <td class="rec">${e.wins}W/${e.draws||0}D/${e.losses}L</td>
      <td class="gc">${cost(e.team)}g</td>
      <td class="team-cell">${esc(teamStr(e.team))}</td>
    </tr>`;
  });

  // UNIT PROFILES
  let unitProfilesHtml='';
  unitPvpArr.forEach(u=>{
    const ud=unitMapRef[u.id]; if(!ud) return;
    const cls=cc(u.wr);
    // Best teams containing this unit in top100
    const uTeams=top100.filter(e=>e.team.includes(u.id)).slice(0,4);
    const uTeamRows=uTeams.map(e=>`<tr><td class="mono">${esc(teamStr(e.team))}</td><td class="${cc(e.wr)} fw-cell">${pct(e.wr)}</td><td class="dim">${e.games}</td></tr>`).join('');
    // Partner frequency in top100 teams
    const partnerCount={};
    uTeams.forEach(e=>e.team.forEach(id=>{if(id!==u.id)partnerCount[id]=(partnerCount[id]||0)+1;}));
    const bestPartners=Object.entries(partnerCount).sort((a,b)=>b[1]-a[1]).slice(0,4);
    const partnerRows=bestPartners.map(([id,n])=>`<tr><td>${uIcon(id)} ${esc(udn(id))}</td><td class="dim">${n}× in top teams</td></tr>`).join('');
    unitProfilesHtml+=`
    <div class="unit-card-pvp" id="upvp-${u.id}">
      <div class="ucp-header">
        <span class="ucp-icon">${uIcon(u.id)}</span>
        <span class="ucp-name">${esc(udn(u.id))}</span>
        <span class="ucp-cost">${ud.cost}g</span>
        <span class="ucp-wr ${cls}">${pct(u.wr)}</span>
      </div>
      <div class="ucp-grid">
        <div class="ucp-card">
          <div class="ucp-label">PvP Record</div>
          <div class="ucp-val">${u.wins}W / ${u.losses}L</div>
          <div class="ucp-label" style="margin-top:.6rem">Appearances</div>
          <div class="ucp-val dim">${u.apps.toLocaleString()}</div>
        </div>
        <div class="ucp-card">
          <div class="ucp-label">Best Partners (top 100)</div>
          <table class="mini-tbl"><tbody>${partnerRows}</tbody></table>
        </div>
        <div class="ucp-card" style="grid-column:span 2">
          <div class="ucp-label">Top Teams containing ${esc(udn(u.id))}</div>
          <table class="mini-tbl"><thead><tr><th>Team</th><th>PvP WR</th><th>Games</th></tr></thead><tbody>${uTeamRows}</tbody></table>
        </div>
      </div>
    </div>`;
  });

  // PODIUM
  const podiumHtml=playoff.slice(0,3).map((e,i)=>{
    const cls=['gold','silver','bronze'][i];
    return `<div class="pod-card ${cls}">
      <div class="pod-medal">${medal(i)}</div>
      <div class="pod-wr">${pct(e.wr)}</div>
      <div class="pod-rec">${e.wins}W/${e.draws||0}D/${e.losses}L</div>
      <div class="pod-cost">${cost(e.team)}g</div>
      <div class="pod-team">${esc(teamStr(e.team))}</div>
    </div>`;
  }).join('');

  const totalBattles=top100.reduce((s,e)=>s+e.games,0);
  const html=`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>Warfront PvP \u2014 ${collection}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600&family=Crimson+Pro:wght@300;400&display=swap');
:root{--gold:#c9a84c;--stone:#1a1410;--stone-mid:#232018;--stone-light:#3d352f;--pc:#f0e8d0;--pcd:#c8b898;--gr:#5cb87a;--ye:#c8a840;--re:#c85050;}
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Crimson Pro',serif;background:var(--stone);color:var(--pc);min-height:100vh;}
.sidebar{position:fixed;top:0;left:0;width:200px;height:100vh;background:#111008;border-right:1px solid var(--stone-light);padding:1.5rem 1rem;overflow-y:auto;z-index:10;}
.sidebar h2{font-family:'Cinzel',serif;font-size:14px;color:var(--gold);letter-spacing:3px;margin-bottom:1.2rem;}
.nav-link{display:block;padding:6px 10px;font-size:13px;color:var(--pcd);text-decoration:none;border-radius:4px;margin-bottom:2px;cursor:pointer;}
.nav-link:hover,.nav-link.active{background:var(--stone-mid);color:var(--gold);}
.nav-section{font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--stone-light);padding:8px 10px 3px;margin-top:.5rem;}
.main{margin-left:200px;padding:2rem 2.5rem;max-width:1200px;}
.page-hdr{text-align:center;margin-bottom:2.5rem;padding-bottom:1.5rem;border-bottom:1px solid var(--stone-light);}
.page-hdr h1{font-family:'Cinzel',serif;font-size:30px;color:var(--gold);letter-spacing:5px;}
.page-hdr p{color:var(--pcd);font-size:14px;font-style:italic;margin-top:.4rem;}
.meta-row{display:flex;gap:14px;justify-content:center;flex-wrap:wrap;margin-top:1rem;}
.meta-pill{background:var(--stone-mid);border:1px solid var(--stone-light);border-radius:6px;padding:5px 16px;font-size:12px;color:var(--pcd);}
.meta-pill strong{color:var(--gold);}
.section-title{font-family:'Cinzel',serif;font-size:13px;color:var(--gold);letter-spacing:2px;text-transform:uppercase;border-bottom:1px solid var(--stone-light);padding-bottom:.5rem;margin:2rem 0 1rem;}
.podium{display:flex;gap:16px;justify-content:center;align-items:flex-end;flex-wrap:wrap;margin-bottom:2rem;}
.pod-card{border-radius:10px;padding:18px 22px;min-width:200px;max-width:270px;text-align:center;border:1px solid var(--stone-light);background:var(--stone-mid);}
.pod-card.gold{border-color:var(--gold);background:#251c08;order:-1;}
.pod-card.silver{border-color:#9090a8;background:#1c1c28;}
.pod-card.bronze{border-color:#9c6e40;background:#1c1208;}
.pod-medal{font-size:26px;margin-bottom:4px;}
.pod-wr{font-family:'Cinzel',serif;font-size:22px;font-weight:600;color:var(--gold);}
.pod-rec{font-size:12px;color:var(--pcd);margin:3px 0;}
.pod-cost{font-size:12px;color:var(--gold);margin-bottom:6px;}
.pod-team{font-size:11px;color:var(--pc);line-height:1.8;}
table{width:100%;border-collapse:collapse;font-size:13px;}
thead th{font-family:'Cinzel',serif;font-size:10px;color:var(--pcd);text-transform:uppercase;letter-spacing:.5px;padding:8px 10px;border-bottom:1px solid var(--stone-light);text-align:left;font-weight:400;}
tbody td{padding:7px 10px;border-bottom:1px solid #1e1a16;}
tbody tr:hover td{background:#262018;}
.rk{font-family:'Cinzel',serif;color:var(--gold);width:44px;font-size:14px;}
.fw-cell{font-weight:600;} .gc{color:var(--gold);width:40px;} .rec{color:var(--pcd);font-size:11px;}
.team-cell{font-family:'Crimson Pro',serif;} .dim{color:var(--pcd);} .mono{font-family:monospace;font-size:11px;}
.gr{color:var(--gr);} .ye{color:var(--ye);} .re{color:var(--re);}
/* Unit profiles */
.unit-card-pvp{background:var(--stone-mid);border:1px solid var(--stone-light);border-radius:8px;padding:16px;margin-bottom:14px;}
.ucp-header{display:flex;align-items:center;gap:10px;margin-bottom:10px;}
.ucp-icon{font-size:20px;} .ucp-name{font-family:'Cinzel',serif;font-size:14px;color:var(--gold);}
.ucp-cost{font-size:11px;color:var(--pcd);} .ucp-wr{font-family:'Cinzel',serif;font-size:16px;font-weight:600;margin-left:auto;}
.ucp-grid{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;}
.ucp-card{background:#181410;border:1px solid var(--stone-light);border-radius:6px;padding:10px;}
.ucp-label{font-size:10px;letter-spacing:.5px;color:var(--pcd);text-transform:uppercase;margin-bottom:4px;}
.ucp-val{font-family:'Cinzel',serif;font-size:14px;color:var(--pc);}
.mini-tbl td,.mini-tbl th{padding:4px 6px;}
.page-section{display:none;} .page-section.active{display:block;}
</style></head><body>
<div class="sidebar">
  <h2>⚔ PVP</h2>
  <div class="nav-section">${collection.toUpperCase()}</div>
  <a class="nav-link active" onclick="showSection('overview')" href="#">🏆 Overview</a>
  <a class="nav-link" onclick="showSection('top100')" href="#">📋 Top 100 Teams</a>
  <a class="nav-link" onclick="showSection('units')" href="#">🎖 Unit Profiles</a>
  <a class="nav-link" onclick="showSection('playoff')" href="#">⚡ Playoff</a>
</div>
<div class="main">
  <!-- OVERVIEW -->
  <div class="page-section active" id="sec-overview">
    <div class="page-hdr">
      <h1>⚔ WARFRONT PVP</h1>
      <p>${collection.charAt(0).toUpperCase()+collection.slice(1)} Collection &mdash; 10g vs 10g</p>
      <div class="meta-row">
        <div class="meta-pill"><strong>${allTeams.length.toLocaleString()}</strong> teams evaluated</div>
        <div class="meta-pill"><strong>${top100.length}</strong> in Top 100</div>
        <div class="meta-pill"><strong>${totalBattles.toLocaleString()}</strong> battles (Top 100)</div>
        <div class="meta-pill">Playoff: top <strong>${playoff.length}</strong> teams</div>
      </div>
    </div>
    <div class="section-title">🏅 Playoff Podium</div>
    <div class="podium">${podiumHtml}</div>
  </div>

  <!-- TOP 100 -->
  <div class="page-section" id="sec-top100">
    <div class="section-title">📋 Top 100 Teams — PvP Win Rate</div>
    <table><thead><tr><th>Rank</th><th>PvP WR</th><th>Record (W/D/L)</th><th>Cost</th><th>Team</th></tr></thead>
    <tbody>${top100Rows}</tbody></table>
  </div>

  <!-- UNIT PROFILES -->
  <div class="page-section" id="sec-units">
    <div class="section-title">🎖 Unit Profiles — PvP Performance</div>
    ${unitProfilesHtml}
  </div>

  <!-- PLAYOFF -->
  <div class="page-section" id="sec-playoff">
    <div class="section-title">⚡ Playoff — Top ${playoff.length} Round-Robin (Best of 10)</div>
    <p class="dim" style="font-size:12px;margin-bottom:1rem">Every team played every other team 10 times. Pure 10g vs 10g skill test.</p>
    <div class="podium">${podiumHtml}</div>
    <table><thead><tr><th>Rank</th><th>Playoff WR</th><th>Record (W/D/L)</th><th>Cost</th><th>Team</th></tr></thead>
    <tbody>${playoffRows}</tbody></table>
  </div>
</div>
<script>
function showSection(id){
  document.querySelectorAll('.page-section').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(l=>l.classList.remove('active'));
  document.getElementById('sec-'+id).classList.add('active');
  document.querySelectorAll('.nav-link').forEach(l=>{if(l.getAttribute('onclick')&&l.getAttribute('onclick').includes("'"+id+"'"))l.classList.add('active');});
}
</script>
</body></html>`;

  fs.writeFileSync(path.resolve(outFile),html,'utf8');
  const abs=path.resolve(outFile);
  process.stdout.write('\n📄 PvP Report: '+abs+'\n   Open: file://'+abs+'\n\n');
}


(async()=>{
  // ─── PvP mode runs before normal sweep and exits early ───────────────

  if(pvpMode){
    const t0pvp=Date.now();
    process.stdout.write('\n⚔  PVP MODE — '+colArg+' collection, strictly 10g vs 10g\n');
    process.stdout.write('🔍 Enumerating all valid 10g teams...\n');
    const allPvp=enumerateTeamsFrom(ACTIVE_UNIT_DEFS,10,6);
    process.stdout.write('   Found '+allPvp.length.toLocaleString()+' unique 10g teams\n');

    // Helper: run team-vs-team tasks across workers
    const runPvpBatch=async(tasks)=>{
      if(!tasks.length) return [];
      return new Promise((res)=>{
        const CHUNK=Math.ceil(tasks.length/numWorkers);
        let done=0; const results=[];
        for(let w=0;w<numWorkers;w++){
          const chunk=tasks.slice(w*CHUNK,(w+1)*CHUNK);
          if(!chunk.length){done++;if(done>=numWorkers)res(results);continue;}
          const wk=new Worker(__filename,{workerData:{pvpTasks:chunk}});
          wk.on('message',msg=>{if(msg.type==='pvpr') results.push(...msg.d);});
          wk.on('exit',()=>{done++;if(done>=numWorkers)res(results);});
        }
      });
    };

    // ── Phase 1: broad sweep — every team vs 30 random opponents ─────────────
    const PVP_BROAD=30;
    process.stdout.write('   Phase 1: broad sweep ('+PVP_BROAD+' random opponents each)...\n');
    const pvpW1=new Map(), pvpG1=new Map();
    allPvp.forEach(t=>{const k=t.join(',');pvpW1.set(k,0);pvpG1.set(k,0);});
    const broadTasks=[];
    allPvp.forEach(t=>{
      const opp=allPvp.filter(o=>o.join(',')!==t.join(',')).sort(()=>Math.random()-.5).slice(0,PVP_BROAD);
      opp.forEach(o=>broadTasks.push({pvpA:t,pvpB:o,n:1,isAnimal:IS_ANIMAL}));
    });
    (await runPvpBatch(broadTasks)).forEach(r=>{
      const kA=r.teamA.join(','),kB=r.teamB.join(',');
      pvpG1.set(kA,(pvpG1.get(kA)||0)+1); pvpG1.set(kB,(pvpG1.get(kB)||0)+1);
      if(r.aWon) pvpW1.set(kA,(pvpW1.get(kA)||0)+1);
      else pvpW1.set(kB,(pvpW1.get(kB)||0)+1);
    });

    // Rank by broad WR → take top 100
    const pvpBroadRanked=allPvp.map(t=>{
      const k=t.join(','); const g=pvpG1.get(k)||0; const w=pvpW1.get(k)||0;
      return{team:t,wr:g>0?w/g:0,wins:w,games:g,losses:g-w};
    }).sort((a,b)=>b.wr-a.wr);
    process.stdout.write('   Phase 1 complete. Top team WR: '+(pvpBroadRanked[0]?.wr*100||0).toFixed(1)+'%\n');

    // ── Phase 2: top 100 play more games among themselves ────────────────────
    const TOP100=Math.min(100,pvpBroadRanked.length);
    const top100teams=pvpBroadRanked.slice(0,TOP100).map(e=>e.team);
    process.stdout.write('   Phase 2: top '+TOP100+' teams, '+pvpN+' games each vs all others...\n');
    const pvpW2=new Map(), pvpG2=new Map();
    top100teams.forEach(t=>{const k=t.join(',');pvpW2.set(k,pvpW1.get(k)||0);pvpG2.set(k,pvpG1.get(k)||0);});
    const refTasks=[];
    top100teams.forEach(t=>{
      top100teams.filter(o=>o.join(',')!==t.join(',')).forEach(o=>{
        for(let i=0;i<pvpN;i++) refTasks.push({pvpA:t,pvpB:o,n:1,isAnimal:IS_ANIMAL});
      });
    });
    (await runPvpBatch(refTasks)).forEach(r=>{
      const kA=r.teamA.join(','),kB=r.teamB.join(',');
      pvpG2.set(kA,(pvpG2.get(kA)||0)+1); pvpG2.set(kB,(pvpG2.get(kB)||0)+1);
      if(r.aWon) pvpW2.set(kA,(pvpW2.get(kA)||0)+1);
      else pvpW2.set(kB,(pvpW2.get(kB)||0)+1);
    });

    const top100Ranked=top100teams.map(t=>{
      const k=t.join(','); const g=pvpG2.get(k)||0; const w=pvpW2.get(k)||0;
      return{team:t,wr:g>0?w/g:0,wins:w,losses:g-w,draws:0,games:g};
    }).sort((a,b)=>b.wr-a.wr);
    process.stdout.write('   Phase 2 complete.\n');

    // ── Phase 3: top 16 playoff round-robin (best-of-10) ────────────────────
    const TOP16=Math.min(16,top100Ranked.length);
    const top16teams=top100Ranked.slice(0,TOP16);
    process.stdout.write('   Phase 3: top '+TOP16+' playoff round-robin (best-of-10)...\n');
    const rrW=new Map(), rrG=new Map();
    top16teams.forEach(e=>{const k=e.team.join(',');rrW.set(k,0);rrG.set(k,0);});
    const rrTasks=[];
    top16teams.forEach(e=>{
      top16teams.filter(o=>o.team.join(',')!==e.team.join(',')).forEach(o=>{
        for(let i=0;i<10;i++) rrTasks.push({pvpA:e.team,pvpB:o.team,n:1,isAnimal:IS_ANIMAL});
      });
    });
    (await runPvpBatch(rrTasks)).forEach(r=>{
      const kA=r.teamA.join(','),kB=r.teamB.join(',');
      rrG.set(kA,(rrG.get(kA)||0)+1); rrG.set(kB,(rrG.get(kB)||0)+1);
      if(r.aWon) rrW.set(kA,(rrW.get(kA)||0)+1);
      else rrW.set(kB,(rrW.get(kB)||0)+1);
    });
    const playoffRanked=top16teams.map(e=>{
      const k=e.team.join(','); const g=rrG.get(k)||0; const w=rrW.get(k)||0;
      return{team:e.team,wr:g>0?w/g:0,wins:w,losses:g-w,draws:0,games:g};
    }).sort((a,b)=>b.wr-a.wr);
    process.stdout.write('   Playoff complete!\n');
    process.stdout.write('   Total time: '+((Date.now()-t0pvp)/1000).toFixed(1)+'s\n');

    // ── Generate PvP report ──────────────────────────────────────────────────
    const pvpOutFile=getArg('--out',IS_ANIMAL?'warfront_pvp_animals.html':'warfront_pvp_fantasy.html');
    generatePvPReport({top100:top100Ranked,playoff:playoffRanked,allTeams:pvpBroadRanked,collection:colArg,outFile:pvpOutFile,unitPool:ACTIVE_UNIT_DEFS,unitMapRef:IS_ANIMAL?ANIMAL_MAP:UNIT_MAP});
    process.exit(0);
  }

  await runPass(teamsToTest,REFINE_PASSES[0].n,'Pass 1 -- broad sweep');
  if(isFullSweep){
    teamResults.forEach(tr=>tr.refinePasses=1);
    const top100=currentSorted().slice(0,100).map(tr=>tr.team);
    await runPass(top100,REFINE_PASSES[1].n,'Pass 2 -- top 100');
    top100.forEach(t=>{const k=t.slice().sort().join(',');if(teamResults.has(k))teamResults.get(k).refinePasses=2;});
    const top50=currentSorted().slice(0,50).map(tr=>tr.team);
    await runPass(top50,REFINE_PASSES[2].n,'Pass 3 -- top 50');
    top50.forEach(t=>{const k=t.slice().sort().join(',');if(teamResults.has(k))teamResults.get(k).refinePasses=3;});
    const top10=currentSorted().slice(0,10).map(tr=>tr.team);
    await runPass(top10,REFINE_PASSES[3].n,'Pass 4 -- top 10');
    top10.forEach(t=>{const k=t.slice().sort().join(',');if(teamResults.has(k))teamResults.get(k).refinePasses=4;});
  }
  const elapsed=((Date.now()-t0)/1000).toFixed(1);
  process.stdout.write('\n   Completed in '+elapsed+'s\n\n');

  const sorted=currentSorted();
  const activePool=IS_ANIMAL?ANIMAL_DEFS:UNIT_DEFS;

  // Unit win rates — equal-weight per tier to avoid difficulty bias
  const unitTierWr={};
  activePool.forEach(u=>{unitTierWr[u.id]={};});
  sorted.forEach(tr=>{
    const ids=new Set(tr.team);
    ids.forEach(id=>{
      if(!unitTierWr[id])unitTierWr[id]={};
      ENEMY_BUDGETS.forEach(b=>{
        const bd=tr.byBudget[b];if(!bd)return;
        if(!unitTierWr[id][b])unitTierWr[id][b]={w:0,t:0};
        unitTierWr[id][b].w+=bd.wins; unitTierWr[id][b].t+=bd.wins+bd.losses;
      });
    });
  });
  const unitWins={},unitApps={};
  activePool.forEach(u=>{
    const tiers=Object.values(unitTierWr[u.id]||{}).filter(v=>v.t>=5);
    if(!tiers.length){unitApps[u.id]=0;unitWins[u.id]=0;return;}
    const avgWr=tiers.reduce((s,v)=>s+(v.w/v.t),0)/tiers.length;
    const totalApps=tiers.reduce((s,v)=>s+v.t,0);
    unitApps[u.id]=totalApps; unitWins[u.id]=Math.round(avgWr*totalApps);
  });

  // Pair synergies
  const pairWins={},pairApps={};
  sorted.forEach(tr=>{
    const total=tr.wins+tr.losses;
    const ids=[...new Set(tr.team)].sort();
    for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){
      const key=ids[i]+'+'+ids[j];
      pairWins[key]=(pairWins[key]||0)+tr.wins;
      pairApps[key]=(pairApps[key]||0)+total;
    }
  });

  // Cost efficiency
  const unitCostEff={};
  activePool.forEach(u=>{const apps=unitApps[u.id]||1;unitCostEff[u.id]=(unitWins[u.id]/apps)/Math.max(1,u.cost);});

  // Budget scaling per unit
  const unitByBudget={};
  activePool.forEach(u=>{unitByBudget[u.id]={};});
  sorted.forEach(tr=>{
    const ids=new Set(tr.team);
    ids.forEach(id=>{
      if(!unitByBudget[id])unitByBudget[id]={};
      ENEMY_BUDGETS.forEach(b=>{
        const bd=tr.byBudget[b];if(!bd)return;
        if(!unitByBudget[id][b])unitByBudget[id][b]={wins:0,apps:0};
        unitByBudget[id][b].wins+=bd.wins; unitByBudget[id][b].apps+=bd.wins+bd.losses;
      });
    });
  });
  const unitScaling={};
  activePool.forEach(u=>{
    const lo=unitByBudget[u.id][11],hi=unitByBudget[u.id][16];
    const wrLo=lo&&lo.apps>0?lo.wins/lo.apps:null;
    const wrHi=hi&&hi.apps>0?hi.wins/hi.apps:null;
    unitScaling[u.id]=(wrLo!==null&&wrHi!==null)?wrHi-wrLo:null;
  });

  // Meta stats
  const sizeWr={1:{w:0,t:0},2:{w:0,t:0},3:{w:0,t:0},4:{w:0,t:0},5:{w:0,t:0},6:{w:0,t:0}};
  sorted.forEach(tr=>{const sz=Math.min(6,new Set(tr.team).size);sizeWr[sz].w+=tr.wins;sizeWr[sz].t+=(tr.wins+tr.losses);});
  const dupWr={dup:{w:0,t:0},uniq:{w:0,t:0}};
  sorted.forEach(tr=>{const bkt=tr.team.length!==new Set(tr.team).size?'dup':'uniq';dupWr[bkt].w+=tr.wins;dupWr[bkt].t+=(tr.wins+tr.losses);});

  // Worst pairs
  const worstPairs=Object.entries(pairWins).filter(([k])=>pairApps[k]>=20)
    .map(([k,w])=>({pair:k.replace('+',' + '),wr:w/pairApps[k],apps:pairApps[k]}))
    .sort((a,b)=>a.wr-b.wr).slice(0,15);

  // Unit best/worst partners
  const unitWorstPartners={},unitBestPartners={};
  activePool.forEach(u=>{
    const partners=Object.entries(pairWins)
      .filter(([k])=>(k.startsWith(u.id+'+')||k.endsWith('+'+u.id))&&pairApps[k]>=10)
      .map(([k,w])=>({unit:k.replace(u.id+'+','').replace('+'+u.id,''),wr:w/pairApps[k],apps:pairApps[k]}));
    unitWorstPartners[u.id]=[...partners].sort((a,b)=>a.wr-b.wr).slice(0,5);
    unitBestPartners[u.id]=[...partners].sort((a,b)=>b.wr-a.wr).slice(0,5);
  });

  // Survival + clutch/dominant
  const unitClutch={},unitDominant={},unitClutchN={},unitAvgPhp={},unitAvgPhpN={};
  const unitSurvival={},unitSurvN={};
  activePool.forEach(u=>{unitClutch[u.id]=0;unitDominant[u.id]=0;unitClutchN[u.id]=0;unitAvgPhp[u.id]=0;unitAvgPhpN[u.id]=0;unitSurvival[u.id]=0;unitSurvN[u.id]=0;});
  sorted.forEach(tr=>{
    const ids=new Set(tr.team); const total=tr.wins+tr.losses;
    ids.forEach(id=>{
      if(unitAvgPhp[id]===undefined)return;
      unitAvgPhp[id]+=tr.totalPhp; unitAvgPhpN[id]+=total;
      unitClutch[id]+=tr.clutchWins; unitDominant[id]+=tr.dominantWins; unitClutchN[id]+=tr.wins;
    });
    if(tr.survAcc) Object.entries(tr.survAcc).forEach(([uid,v])=>{
      if(unitSurvival[uid]!==undefined){unitSurvival[uid]+=v.s;unitSurvN[uid]+=v.t;}
    });
  });

  // Playoff top-10 round robin
  let playoffStandings=null,playoffResults=null;
  if(isFullSweep){
    process.stdout.write('   -- Pass 5 -- Playoff (top 10 round-robin)\n');
    const playoffTeams=currentSorted().slice(0,10).map(tr=>tr.team);
    const pRes={};
    for(let a=0;a<playoffTeams.length;a++){
      for(let b2=a+1;b2<playoffTeams.length;b2++){
        let wA=0,wB=0;
        for(let g=0;g<10;g++){
          const pT=g%2===0?playoffTeams[a]:playoffTeams[b2];
          const eT=g%2===0?playoffTeams[b2]:playoffTeams[a];
          const r=IS_ANIMAL?runBattleAnimal([...pT],[...eT]):runBattleFast([...pT],[...eT]);
          if(g%2===0){if(r.win)wA++;else wB++;}else{if(r.win)wB++;else wA++;}
        }
        const key=[...playoffTeams[a]].sort().join(',')+' | '+[...playoffTeams[b2]].sort().join(',');
        pRes[key]={teamA:playoffTeams[a],teamB:playoffTeams[b2],winsA:wA,winsB:wB};
      }
    }
    playoffResults=pRes;
    playoffStandings=playoffTeams.map(t=>{
      const kt=[...t].sort().join(',');
      let mW=0,mL=0,gW=0,gL=0;
      Object.values(pRes).forEach(m=>{
        const kA=[...m.teamA].sort().join(','),kB=[...m.teamB].sort().join(',');
        if(kA===kt){gW+=m.winsA;gL+=m.winsB;if(m.winsA>m.winsB)mW++;else mL++;}
        else if(kB===kt){gW+=m.winsB;gL+=m.winsA;if(m.winsB>m.winsA)mW++;else mL++;}
      });
      return{team:t,matchWins:mW,matchLosses:mL,gameWins:gW,gameLosses:gL};
    }).sort((a,b)=>b.matchWins-a.matchWins);
    process.stdout.write('   Playoff complete\n');
  }


// ─────────────────────────────────────────────────────────────────────────────
// PVP MODE: 10g teams fight each other (not random enemy budgets)
// ─────────────────────────────────────────────────────────────────────────────

  // ── Aggregate per-unit battle stats from all team results
  const unitBattleStats={};
  activePool.forEach(u=>{unitBattleStats[u.id]={dmgDealt:0,dmgTaken:0,support:0,disruption:0,abilityUses:0,baseDmg:0,battles:0};});
  sorted.forEach(tr=>{
    if(!tr.bStatsAcc) return;
    Object.entries(tr.bStatsAcc).forEach(([id,bs])=>{
      if(!unitBattleStats[id]) unitBattleStats[id]={dmgDealt:0,dmgTaken:0,support:0,disruption:0,abilityUses:0,baseDmg:0,battles:0};
      const t=unitBattleStats[id];
      t.dmgDealt+=bs.dmgDealt; t.dmgTaken+=bs.dmgTaken;
      t.support+=bs.support; t.disruption+=bs.disruption;
      t.abilityUses+=bs.abilityUses; t.baseDmg+=bs.baseDmg;
      t.battles+=bs.battles;
    });
  });

  generateHTMLReport({
    sorted,unitWins,unitApps,pairWins,pairApps,
    unitCostEff,unitScaling,unitByBudget,
    sizeWr,dupWr,worstPairs,
    unitWorstPartners,unitBestPartners,
    unitClutch,unitDominant,unitClutchN,unitAvgPhp,unitAvgPhpN,
    unitSurvival,unitSurvN,
    unitBattleStats,
    playoffStandings,playoffResults,
    elapsed,
    totalBattles:[...teamResults.values()].reduce((s,tr)=>s+tr.wins+tr.losses,0),
    outFile,isFullSweep,
    activePool
  });
})().catch(err=>{process.stderr.write('\nError: '+err.stack+'\n');process.exit(1);});





















// Safe collection-aware unit lookup — works even if ACTIVE_UNIT_MAP not in scope
function uLook(id){
  try{if(typeof ACTIVE_UNIT_MAP!=='undefined'&&ACTIVE_UNIT_MAP&&ACTIVE_UNIT_MAP[id])return ACTIVE_UNIT_MAP[id];}catch(e){}
  try{if(typeof ANIMAL_MAP!=='undefined'&&ANIMAL_MAP[id])return ANIMAL_MAP[id];}catch(e){}
  try{if(typeof UNIT_MAP!=='undefined'&&UNIT_MAP[id])return UNIT_MAP[id];}catch(e){}
  return {cost:0,id,lane:'ground',ranged:false,melee:true,spd:50,aoeR:0,isShaman:false,isNecro:false,isWarlord:false,canHitFlying:false};
}


function generateHTMLReport({
  sorted,unitWins,unitApps,pairWins,pairApps,
  unitCostEff,unitScaling,unitByBudget,
  sizeWr,dupWr,worstPairs,
  unitWorstPartners,unitBestPartners,
  unitClutch,unitDominant,unitClutchN,unitAvgPhp,unitAvgPhpN,
  unitSurvival,unitSurvN,
  unitBattleStats,
  playoffStandings,playoffResults,
  activePool,
  elapsed,totalBattles,outFile,isFullSweep
}){
  const fs=require('fs'), path=require('path');
  const BUDGETS=[11,12,13,14,15,16];
  const DIFF={11:'Easy',12:'Normal',13:'Hard',14:'Brutal',15:'Legendary',16:'Impossible'};

  // ── helpers ──────────────────────────────────────────────────────────────────
  const pF=x=>(x*100).toFixed(1);
  const pct=x=>pF(x)+'%';
  const cc=x=>x>=0.6?'gr':x>=0.45?'ye':'re';       // colour class key
  const sgn=x=>(x>=0?'+':'')+pF(x)+'%';
  const sgnC=x=>x>=0.03?'gr':x<=-0.05?'re':'ye';
  const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

  const top15=sorted.slice(0,15);
  const undefeated=sorted.filter(tr=>tr.losses===0);
  // activePool is passed as a parameter — use it everywhere instead of UNIT_DEFS
  const REPORT_POOL=activePool||UNIT_DEFS;
  const unitIds=REPORT_POOL.map(u=>u.id);
  const unitDisplayName=Object.fromEntries(REPORT_POOL.map(u=>[u.id, u.displayName||u.id]));

  const bestPairs=Object.entries(pairWins)
    .filter(([k])=>pairApps[k]>=20)
    .map(([k,w])=>({pair:k.replace('+',' + '),wr:w/pairApps[k],apps:pairApps[k]}))
    .sort((a,b)=>b.wr-a.wr).slice(0,20);

  // ── unit detail objects ───────────────────────────────────────────────────────
  const unitDetails=REPORT_POOL.map(u=>{
    const apps=unitApps[u.id]||0;
    const wr=apps>0?unitWins[u.id]/apps:0;
    const costEff=unitCostEff[u.id]||0;
    const scaling=unitScaling[u.id];
    const survRate=unitSurvN[u.id]>0?(unitSurvival[u.id]/unitSurvN[u.id]):null;
    const avgPhp=unitAvgPhpN[u.id]>0?(unitAvgPhp[u.id]/unitAvgPhpN[u.id]):null;
    const clutchRate=unitClutchN[u.id]>0?(unitClutch[u.id]/unitClutchN[u.id]):null;
    const domRate=unitClutchN[u.id]>0?(unitDominant[u.id]/unitClutchN[u.id]):null;
    const topTeams=sorted.filter(tr=>tr.team.includes(u.id)).slice(0,4);
    const budgetWrs=BUDGETS.map(b=>{
      const bd=unitByBudget[u.id][b];
      return bd&&bd.apps>0?bd.wins/bd.apps:null;
    });
    return {...u,apps,wr,costEff,scaling,survRate,avgPhp,clutchRate,domRate,
      topTeams,budgetWrs,
      bestPartners:(unitBestPartners[u.id]||[]).slice(0,6),
      worstPartners:(unitWorstPartners[u.id]||[]).slice(0,4)};
  }).sort((a,b)=>b.wr-a.wr);

  // ── heatmap colour ────────────────────────────────────────────────────────────
  const hmC=wr=>{
    if(wr===null) return '#181410';
    const cols=['#3d0d0d','#5c1818','#7a2e0e','#7e4e0e','#7a5e0e','#4e7e1a','#2a7a3a','#1a5858','#0e4a2a','#0a3518'];
    return cols[Math.min(9,Math.max(0,Math.round(wr*9)))];
  };

  // ── radar chart SVG ───────────────────────────────────────────────────────────
  // Radar chart: 240×240 viewBox, labels outside ring, normalized vs collection max
  const radarSVG=(u,size=240)=>{
    // Normalize each axis vs the best unit in the pool
    const poolWrs=unitDetails.map(p=>p.wr||0);
    const poolSurv=unitDetails.map(p=>p.survRate||0);
    const poolDom=unitDetails.map(p=>p.domRate||0);
    const ubsAll=unitBattleStats||{};
    const allDmg=Object.values(ubsAll).map(b=>b.battles>0?b.dmgDealt/b.battles:0);
    const allSup=Object.values(ubsAll).map(b=>b.battles>0?b.support/b.battles:0);
    const allDis=Object.values(ubsAll).map(b=>b.battles>0?b.disruption/b.battles:0);
    const mWr=Math.max(...poolWrs,0.01), mSurv=Math.max(...poolSurv,0.01);
    const mDom=Math.max(...poolDom,0.01);
    const mDmg=Math.max(...allDmg,1), mSup=Math.max(...allSup,1), mDis=Math.max(...allDis,1);

    const ubsR=ubsAll[u.id]; const hasBs=ubsR&&ubsR.battles>0;
    const axes=[
      {label:'Win Rate',   val:Math.min(1,(u.wr||0)/mWr)},
      {label:'Damage',     val:hasBs?Math.min(1,(ubsR.dmgDealt/ubsR.battles)/mDmg):Math.min(1,(u.domRate||0)/mDom)},
      {label:'Tanky',      val:Math.min(1,(u.survRate||0)/mSurv)},
      {label:'Support',    val:hasBs?Math.min(1,(ubsR.support/ubsR.battles)/mSup):(u.id==='shaman'||u.id==='warlord'||u.id==='zebra'?0.7:0)},
      {label:'Disruption', val:hasBs?Math.min(1,(ubsR.disruption/ubsR.battles)/mDis):(u.slowOnHit||u.stinkCloud||u.punchStun?0.5:0)},
      {label:'Scaling',    val:u.scaling!=null?Math.max(0,Math.min(1,(u.scaling+0.3)/0.6)):0.5},
    ];
    const n=axes.length, cx=size/2, cy=size/2, r=size*0.29;
    const angle=i=>(Math.PI*2*i/n)-Math.PI/2;
    const pt=(i,fr)=>{const a=angle(i);return[cx+Math.cos(a)*r*fr,cy+Math.sin(a)*r*fr];};
    let rings='',spokes='',labels='';
    [0.25,0.5,0.75,1].forEach(fr=>{
      const pts=axes.map((_,i)=>pt(i,fr).join(',')).join(' ');
      rings+=`<polygon points="${pts}" fill="none" stroke="#3a3028" stroke-width="${fr===1?1.2:0.5}"/>`;
    });
    axes.forEach((_,i)=>{
      const[x,y]=pt(i,1);
      spokes+=`<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#3a3028" stroke-width="0.8"/>`;
    });
    // Labels: pushed to 1.5×r, text-anchor + dy chosen by angular position
    axes.forEach((a,i)=>{
      const ang=angle(i);
      const[x,y]=pt(i,1.55);
      const anchor=Math.cos(ang)>0.25?'start':Math.cos(ang)<-0.25?'end':'middle';
      const dy=Math.sin(ang)<-0.5?'-0.1em':Math.sin(ang)>0.5?'1.0em':'0.4em';
      labels+=`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" dy="${dy}" font-size="9.5" fill="#c0a060" font-family="Cinzel,serif">${esc(a.label)}</text>`;
    });
    const datapts=axes.map((a,i)=>pt(i,Math.max(0.04,Math.min(1,a.val))).join(',')).join(' ');
    const dots=axes.map((a,i)=>{const[x,y]=pt(i,Math.max(0.04,Math.min(1,a.val)));return `<circle cx="${x}" cy="${y}" r="2" fill="#c9a84c"/>`;}).join('');
    return (
      `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">` +
      rings+spokes+
      `<polygon points="${datapts}" fill="rgba(201,168,76,0.18)" stroke="#c9a84c" stroke-width="1.5"/>` +
      dots+labels+
      `</svg>`
    );
  };

  // ── auto insights ─────────────────────────────────────────────────────────────
  const insights=[];
  const topCE=REPORT_POOL.filter(u=>unitApps[u.id]>0).sort((a,b)=>unitCostEff[b.id]-unitCostEff[a.id]);
  if(topCE.length) insights.push('Cost efficiency leader: <strong>'+topCE[0].id+'</strong> ('+topCE[0].cost+'g) scores '+(unitCostEff[topCE[0].id]*100).toFixed(1)+' WR/gold. If much higher than others of the same cost, consider a slight stat reduction.');
  const mostClutch=REPORT_POOL.filter(u=>unitClutchN[u.id]>10).sort((a,b)=>(unitClutch[b.id]/unitClutchN[b.id])-(unitClutch[a.id]/unitClutchN[a.id]));
  if(mostClutch.length) insights.push('Most clutch unit: <strong>'+mostClutch[0].id+'</strong> creates the highest rate of nail-biter victories (base HP below 30). Good for game feel.');
  const worstSc=REPORT_POOL.filter(u=>unitScaling[u.id]!==null).sort((a,b)=>unitScaling[a.id]-unitScaling[b.id]);
  if(worstSc.length) insights.push('Worst scaling: <strong>'+worstSc[0].id+'</strong> drops '+sgn(unitScaling[worstSc[0].id])+' from Easy to Impossible enemies. May need a base stat buff or its kit countered by high-budget armies by design.');
  const mostDom=REPORT_POOL.filter(u=>unitClutchN[u.id]>10).sort((a,b)=>(unitDominant[b.id]/unitClutchN[b.id])-(unitDominant[a.id]/unitClutchN[a.id]));
  if(mostDom.length) insights.push('Most dominant: <strong>'+mostDom[0].id+'</strong> produces the most stomping victories (HP above 70 remaining). Teams built around it feel very safe — consider a mild nerf if overrepresented in top teams.');
  const dupV=dupWr.dup.t>0?dupWr.dup.w/dupWr.dup.t:0, uniqV=dupWr.uniq.t>0?dupWr.uniq.w/dupWr.uniq.t:0;
  insights.push('Duplicate stacking '+(dupV>uniqV?'helps':'hurts')+': teams with duplicates win '+pct(dupV)+' vs '+pct(uniqV)+' for diverse rosters. '+(dupV>uniqV+0.05?'Stacking is too strong — consider a diminishing returns mechanic.':'Diversity is rewarded. Healthy.'));

  // ── build unit profile pages ──────────────────────────────────────────────────
  let unitPages='';
  unitDetails.filter(u=>u.apps>0).forEach(u=>{
    const cls=cc(u.wr);
    let bp='';
    u.bestPartners.forEach(p=>{
      bp+='<tr><td>'+esc(p.unit)+'</td><td class="'+cc(p.wr)+' fw">'+pct(p.wr)+'</td></tr>';
    });
    let wp='';
    u.worstPartners.forEach(p=>{
      wp+='<tr><td>'+esc(p.unit)+'</td><td class="re fw">'+pct(p.wr)+'</td></tr>';
    });
    let bwRows='';
    BUDGETS.forEach((b,bi)=>{
      const bd=unitByBudget[u.id][b];
      const wr=bd&&bd.apps>0?bd.wins/bd.apps:null;
      bwRows+='<tr><td>'+b+'g <span class="dim">'+DIFF[b]+'</span></td>';
      bwRows+='<td class="'+(wr!==null?cc(wr):'dim')+' fw">'+(wr!==null?pct(wr):'—')+'</td>';
      bwRows+='<td><div class="btrack" style="width:120px"><div class="bfill" style="width:'+(wr!==null?Math.round(wr*100):0)+'%;background:'+(wr!==null?(wr>=0.6?'var(--gr)':wr>=0.45?'var(--ye)':'var(--re)'):'#333')+'"></div></div></td></tr>';
    });
    let ttRows='';
    u.topTeams.forEach(tr=>{
      const total=tr.wins+tr.losses, wr2=tr.wins/total;
      ttRows+='<tr><td class="mono">'+esc(tr.team.join(', '))+'</td><td class="'+cc(wr2)+' fw">'+pct(wr2)+'</td><td class="dim">'+(total).toLocaleString()+'</td></tr>';
    });
    const costEffVerdict=u.costEff>0.12?'<span class="badge re-b">May be OP</span>':u.costEff>0.10?'<span class="badge ye-b">Strong</span>':u.costEff>0.07?'<span class="badge gr-b">Balanced</span>':'<span class="badge bl-b">Undertuned?</span>';

    unitPages+='<div class="page unit-page" id="unit-'+u.id+'" style="display:none">';
    unitPages+='<div class="page-header"><button class="back-btn" onclick="showPage(\'units\')">← All Units</button><div class="page-title">'+( u.displayName||u.id)+'</div><div class="page-sub">'+u.cost+'g · <span class="'+cls+' fw">'+pct(u.wr)+' win rate</span></div></div>';
    unitPages+='<div class="unit-detail-grid">';
    // Left: radar + quick stats
    unitPages+='<div class="ucard"><div class="radar-wrap">'+radarSVG(u)+'</div>';
    // Per-match battle stats from simulation tracking
    const bs=unitBattleStats&&unitBattleStats[u.id];
    const bm=bs&&bs.battles>0?bs.battles:null;
    const isAnimalUnit=(activePool||[]).some(p=>p.collection==='animals'&&p.id===u.id);
    const avgDmgDealt=bm?Math.round(bs.dmgDealt/bm):null;
    const avgDmgTaken=bm?Math.round(bs.dmgTaken/bm):null;
    const avgSupport=bm?Math.round(bs.support/bm):null;
    const avgDisruption=bm?(bs.disruption/bm).toFixed(1):null;
    const avgAbility=bm?(bs.abilityUses/bm).toFixed(1):null;
    const avgBaseDmg=bm?Math.round(bs.baseDmg/bm):null;
    unitPages+='<table class="mini-tbl"><tbody>';
    unitPages+='<tr><td class="dim">Win Rate</td><td class="'+cls+' fw">'+pct(u.wr)+'</td></tr>';
    const naNote=(!bm&&!isAnimalUnit)?'<span class="dim" style="font-size:10px">(fantasy stats coming soon)</span>':'—';
    unitPages+='<tr><td class="dim">Avg Dmg Dealt/match</td><td class="fw">'+(avgDmgDealt!=null?avgDmgDealt:naNote)+'</td></tr>';
    unitPages+='<tr><td class="dim">Avg Dmg Taken/match</td><td>'+(avgDmgTaken!=null?avgDmgTaken:'—')+'</td></tr>';
    unitPages+='<tr><td class="dim">Support Impact/match</td><td class="gr">'+(avgSupport!=null&&avgSupport>0?'+'+avgSupport:'—')+'</td></tr>';
    unitPages+='<tr><td class="dim">Disruptions/match</td><td class="ye">'+(avgDisruption!=null&&avgDisruption>0?avgDisruption+'×':'—')+'</td></tr>';
    unitPages+='<tr><td class="dim">Ability Uses/match</td><td>'+(avgAbility!=null?avgAbility+'×':'—')+'</td></tr>';
    unitPages+='<tr><td class="dim">Base Dmg (w/ enemies)</td><td class="re">'+(avgBaseDmg!=null&&avgBaseDmg>0?avgBaseDmg:'—')+'</td></tr>';
    unitPages+='<tr><td class="dim">Scaling 11→16g</td><td class="'+(u.scaling!=null?sgnC(u.scaling):'dim')+'">'+(u.scaling!=null?sgn(u.scaling):'—')+'</td></tr>';
    unitPages+='</tbody></table></div>';
    // Best/Worst enemy unit matchups — inferred from team co-occurrence and win data
    // Units that appear in teams that BEAT teams containing u → "bad matchup for u"
    // Units that appear in teams that LOSE to teams containing u → "good matchup for u"
    // Use ALL sorted teams for matchup signal (pass1 = most variety, broadest coverage)
    const oppTeams=sorted.filter(tr=>!tr.team.includes(u.id));
    const vsUnit={};
    oppTeams.forEach(opp=>{
      // Weight each team equally regardless of battles (pass1 teams get same signal as refined)
      const oppWr=(opp.wins+opp.losses)>0?opp.wins/(opp.wins+opp.losses):0.5;
      opp.team.forEach(eid=>{
        if(!vsUnit[eid]) vsUnit[eid]={beatUs:0,loseToUs:0,n:0};
        vsUnit[eid].n++;
        // Accumulate win-rate deviation from 50%
        if(oppWr>0.5) vsUnit[eid].beatUs+=oppWr-0.5;
        else vsUnit[eid].loseToUs+=0.5-oppWr;
      });
    });
    const minSample=Math.max(5,Math.floor(oppTeams.length*0.002)); // at least 0.2% coverage
    const vsArr=Object.entries(vsUnit).filter(([,v])=>v.n>=minSample).map(([id,v])=>({
      id,threat:v.beatUs/Math.max(1,v.n),easy:v.loseToUs/Math.max(1,v.n)
    }));
    const threats=vsArr.slice().sort((a,b)=>b.threat-a.threat).slice(0,3);
    const easies=vsArr.slice().sort((a,b)=>b.easy-a.easy).slice(0,3);
    // Middle: partners + matchups in same card
    unitPages+='<div class="ucard"><h3>Best Partners</h3><table class="mini-tbl"><tbody>'+bp+'</tbody></table>';
    unitPages+='<h3 style="margin-top:1rem;color:var(--re)">Worst Partners</h3><table class="mini-tbl"><tbody>'+wp+'</tbody></table>';
    // Enemy matchups inside the same card, after worst partners
    if(threats.length){
      unitPages+='<div style="margin-top:1rem"><div class="matchup-label bad">⚠ Tough enemies</div><div style="margin-top:.3rem">';
      threats.forEach(t=>{const eu=activePool.find(p=>p.id===t.id);if(eu)unitPages+='<div class="matchup-chip bad">'+(eu.icon||'')+' '+(eu.displayName||eu.id)+'</div>';});
      unitPages+='</div></div>';
    }
    if(easies.length){
      unitPages+='<div style="margin-top:.6rem"><div class="matchup-label good">✓ Easy enemies</div><div style="margin-top:.3rem">';
      easies.forEach(t=>{const eu=activePool.find(p=>p.id===t.id);if(eu)unitPages+='<div class="matchup-chip good">'+(eu.icon||'')+' '+(eu.displayName||eu.id)+'</div>';});
      unitPages+='</div></div>';
    }
    unitPages+='</div>';
    // Right: budget breakdown + top teams
    unitPages+='<div class="ucard"><h3>vs Enemy Budget</h3><table class="mini-tbl"><tbody>'+bwRows+'</tbody></table>';
    if(ttRows) unitPages+='<h3 style="margin-top:1rem">Top Teams</h3><table class="mini-tbl"><thead><tr><th>Team</th><th>WR</th><th>Battles</th></tr></thead><tbody>'+ttRows+'</tbody></table>';
    unitPages+='</div>';
    unitPages+='</div></div>'; // unit-detail-grid, page
  });

  // ── Team detail pages for top 15 teams ──────────────────────────────────────
  let teamDetailPages='';
  top15.forEach((tr,rank)=>{
    const total=tr.wins+tr.losses;
    const wr=tr.wins/total;
    const cls=cc(wr);
    const teamPageId='team-'+tr.team.slice().sort().join('-').replace(/[^a-z0-9-]/g,'');
    const cost=tr.team.reduce((s,id)=>s+uLook(id).cost,0);
    const avgHp=(tr.totalPhp/total).toFixed(0);

    // Per-budget analysis
    let budgetRows='';
    let weakestBudget=null, weakestWr=1, strongestBudget=null, strongestWr=0;
    BUDGETS.forEach(b=>{
      const bd=tr.byBudget[b]; if(!bd) return;
      const bwr=bd.wins/(bd.wins+bd.losses);
      if(bwr<weakestWr){weakestWr=bwr;weakestBudget=b;}
      if(bwr>strongestWr){strongestWr=bwr;strongestBudget=b;}
      budgetRows+='<tr>';
      budgetRows+='<td>'+b+'g <span class="dim">'+DIFF[b]+'</span></td>';
      budgetRows+='<td class="'+cc(bwr)+' fw">'+pct(bwr)+'</td>';
      budgetRows+='<td class="dim">'+bd.wins+'W/'+(bd.draws||0)+'D/'+bd.losses+'L</td>';
      budgetRows+='<td><div class="btrack" style="width:120px"><div class="bfill" style="width:'+Math.round(bwr*100)+'%;background:'+(bwr>=0.6?'var(--gr)':bwr>=0.45?'var(--ye)':'var(--re)')+'"></div></div></td>';
      budgetRows+='</tr>';
    });

    // Unit composition breakdown
    let unitComp='';
    const teamSet=new Set(tr.team);
    const counts={};
    tr.team.forEach(id=>{counts[id]=(counts[id]||0)+1;});
    Object.entries(counts).forEach(([id,cnt])=>{
      const ud=uLook(id);
      const unitWr2=unitApps[id]>0?unitWins[id]/unitApps[id]:0;
      unitComp+='<tr>';
      unitComp+='<td><a href="#" class="unit-link fw '+cc(unitWr2)+'" data-unit="'+id+'">'+esc(id)+'</a>'+(cnt>1?' ×'+cnt:'')+'</td>';
      unitComp+='<td class="dim">'+ud.cost+'g</td>';
      unitComp+='<td class="'+cc(unitWr2)+'">'+pct(unitWr2)+'</td>';
      unitComp+='</tr>';
    });

    // What this team is weak against (units that appear in teams beating it)
    // Use the worst budget tier as proxy for weakness
    const weakTier=weakestBudget||16;
    const weakBd=tr.byBudget[weakTier];
    let weaknessNote='';
    if(weakBd){
      const overallLossRate=tr.losses/total;
      if(overallLossRate>0.4) weaknessNote='<div class="insight" style="margin-top:.8rem">⚠ Loses '+pct(overallLossRate)+' of all battles. Particularly struggles vs '+weakTier+'g ('+DIFF[weakTier]+') enemies.</div>';
      else if(overallLossRate>0.2) weaknessNote='<div class="insight" style="margin-top:.8rem;border-left-color:var(--ye)">This team is competitive but starts losing against '+weakTier+'g ('+DIFF[weakTier]+') enemies.</div>';
      else weaknessNote='<div class="insight" style="margin-top:.8rem;border-left-color:var(--gr)">Excellent team — strongest at '+strongestBudget+'g. Only real weakness: '+weakTier+'g enemies.</div>';
    }

    // Team strengths summary
    const hasFlying=tr.team.some(id=>uLook(id).lane==='air');
    const hasRanged=tr.team.some(id=>uLook(id).ranged&&!uLook(id).isShaman);
    const hasMelee=tr.team.some(id=>uLook(id).melee);
    const hasSupport=tr.team.some(id=>{const u=uLook(id);return u.isShaman||u.isNecro||u.isWarlord||u.healRange>0;});
    let strengths=[];
    if(hasFlying) strengths.push('Flying units (bypass ground)');
    if(hasRanged) strengths.push('Ranged presence');
    if(hasMelee) strengths.push('Melee frontline');
    if(hasSupport) strengths.push('Support/aura');

    teamDetailPages+='<div class="page" id="'+teamPageId+'" style="display:none">';
    teamDetailPages+='<div class="page-header"><button class="back-btn" onclick="showPage(&apos;top-teams&apos;)">← Top Teams</button>';
    teamDetailPages+='<div class="page-title">#'+(rank+1)+' Team</div>';
    teamDetailPages+='<div class="page-sub"><span class="'+cls+' fw">'+pct(wr)+'</span> overall win rate · '+cost+'g</div></div>';
    teamDetailPages+='<div class="mono" style="font-size:16px;margin-bottom:1rem;color:var(--gold2)">'+esc(tr.team.join(' + '))+'</div>';
    teamDetailPages+='<div class="unit-detail-grid">';

    // Column 1: per-budget breakdown
    teamDetailPages+='<div class="ucard"><h3>Performance by Enemy Tier</h3>';
    teamDetailPages+='<table class="mini-tbl"><thead><tr><th>Enemy</th><th>WR</th><th>Record</th><th>Bar</th></tr></thead><tbody>'+budgetRows+'</tbody></table>';
    teamDetailPages+=weaknessNote+'</div>';

    // Column 2: unit composition
    teamDetailPages+='<div class="ucard"><h3>Unit Composition</h3>';
    teamDetailPages+='<table class="mini-tbl"><thead><tr><th>Unit</th><th>Cost</th><th>Unit WR</th></tr></thead><tbody>'+unitComp+'</tbody></table>';
    teamDetailPages+='<h3 style="margin-top:1rem">Team Traits</h3>';
    strengths.forEach(s=>{teamDetailPages+='<div class="dim" style="font-size:12px;padding:2px 0">✓ '+esc(s)+'</div>';});
    teamDetailPages+='<div style="margin-top:1rem"><table class="mini-tbl"><tbody>';
    teamDetailPages+='<tr><td class="dim">Total battles</td><td>'+total.toLocaleString()+'</td></tr>';
    teamDetailPages+='<tr><td class="dim">Avg HP remaining</td><td>'+avgHp+'</td></tr>';
    teamDetailPages+='<tr><td class="dim">Clutch wins</td><td>'+(tr.wins>0?pct(tr.clutchWins/tr.wins):'—')+'</td></tr>';
    teamDetailPages+='<tr><td class="dim">Dominant wins</td><td>'+(tr.wins>0?pct(tr.dominantWins/tr.wins):'—')+'</td></tr>';
    teamDetailPages+='<tr><td class="dim">Refinement pass</td><td>'+(tr.refinePasses||0)+'/4</td></tr>';
    teamDetailPages+='</tbody></table></div></div>';

    // Column 3: vs each budget detailed
    teamDetailPages+='<div class="ucard"><h3>Weakness Analysis</h3>';
    if(weakestBudget){
      const wbd=tr.byBudget[weakestBudget];
      teamDetailPages+='<div style="margin-bottom:.8rem"><div class="re fw">Most vulnerable vs: '+weakestBudget+'g ('+DIFF[weakestBudget]+')</div>';
      teamDetailPages+='<div class="dim" style="font-size:12px">Win rate: '+pct(wbd.wins/(wbd.wins+wbd.losses))+' ('+wbd.wins+'W/'+wbd.losses+'L)</div></div>';
    }
    if(strongestBudget){
      const sbd=tr.byBudget[strongestBudget];
      teamDetailPages+='<div style="margin-bottom:.8rem"><div class="gr fw">Strongest vs: '+strongestBudget+'g ('+DIFF[strongestBudget]+')</div>';
      teamDetailPages+='<div class="dim" style="font-size:12px">Win rate: '+pct(sbd.wins/(sbd.wins+sbd.losses))+' ('+sbd.wins+'W/'+sbd.losses+'L)</div></div>';
    }
    // Worst enemy UNITS for this team (computed from teams that beat this team's members)
    const teamIds=new Set(tr.team);
    const teamOppTeams=sorted.filter(otr=>!tr.team.some(id=>otr.team.includes(id)));
    const tvUnit={};
    teamOppTeams.forEach(opp=>{
      const oppWr=(opp.wins+opp.losses)>0?opp.wins/(opp.wins+opp.losses):0.5;
      opp.team.forEach(eid=>{
        if(!tvUnit[eid]) tvUnit[eid]={beat:0,lose:0,n:0};
        tvUnit[eid].n++;
        if(oppWr>0.5) tvUnit[eid].beat+=oppWr-0.5;
        else tvUnit[eid].lose+=0.5-oppWr;
      });
    });
    const tvArr=Object.entries(tvUnit).filter(([,v])=>v.n>3).map(([id,v])=>({
      id,threat:v.beat/Math.max(1,v.n),easy:v.lose/Math.max(1,v.n)
    }));
    const teamThreats=tvArr.slice().sort((a,b)=>b.threat-a.threat).slice(0,3);
    const teamEasies=tvArr.slice().sort((a,b)=>b.easy-a.easy).slice(0,3);

    teamDetailPages+='<h3 style="margin-top:.8rem">Enemy units to watch</h3>';
    if(teamThreats.length){
      teamDetailPages+='<div class="matchup-label bad" style="font-size:10px;margin-top:.4rem">⚠ Difficult enemy units</div>';
      teamThreats.forEach(t=>{const eu=activePool.find(p=>p.id===t.id);if(eu)teamDetailPages+='<div class="matchup-chip bad">'+(eu.icon||'')+' '+(eu.displayName||eu.id)+'</div>';});
    }
    if(teamEasies.length){
      teamDetailPages+='<div class="matchup-label good" style="font-size:10px;margin-top:.5rem">✓ Easy enemy units</div>';
      teamEasies.forEach(t=>{const eu=activePool.find(p=>p.id===t.id);if(eu)teamDetailPages+='<div class="matchup-chip good">'+(eu.icon||'')+' '+(eu.displayName||eu.id)+'</div>';});
    }
    // Generic counter archetypes
    teamDetailPages+='<h3 style="margin-top:.8rem">Counter archetypes</h3>';
    const hasNoFlying=!hasFlying;
    const hasNoRangedAir=!tr.team.some(id=>{const u=uLook(id);return u.ranged&&u.canHitFlying;});
    const isSlowTeam=tr.team.every(id=>uLook(id).spd<70);
    if(hasNoFlying) teamDetailPages+='<div class="dim" style="font-size:12px;padding:2px 0">⚠ No flying units — enemy air units route uncontested</div>';
    if(hasNoRangedAir) teamDetailPages+='<div class="dim" style="font-size:12px;padding:2px 0">⚠ Cannot hit flying — Fairy/Phoenix/Drake/Bat bypass this team</div>';
    if(isSlowTeam) teamDetailPages+='<div class="dim" style="font-size:12px;padding:2px 0">⚠ Low mobility — fast rushers (Cavalry, Rhino) reach base before engagement</div>';
    const hasNoAoE=!tr.team.some(id=>{const u=uLook(id);return u.aoeR>0;});
    if(hasNoAoE) teamDetailPages+='<div class="dim" style="font-size:12px;padding:2px 0">⚠ No AoE — swarm compositions (Wolf Pack ×3) are hard to clear</div>';
    teamDetailPages+='</div>';

    teamDetailPages+='</div></div>'; // unit-detail-grid, page
  });

  // ── main page HTML chunks ─────────────────────────────────────────────────────
  // insights page
  let insightsHtml='<div class="page" id="insights"><h2>Balance Insights</h2><p class="note">Auto-generated findings. Use to guide tuning.</p>';
  insights.forEach(i=>{ insightsHtml+='<div class="insight">'+i+'</div>'; });
  insightsHtml+='</div>';

  // top teams page
  let topTeamsHtml='<div class="page" id="top-teams"><h2>Top 15 Teams</h2><p class="note">Ranked by overall win rate across all enemy budgets. ★ badges indicate refinement pass depth.</p>';
  topTeamsHtml+='<div class="tbl-wrap"><table><thead><tr><th>#</th><th>Team</th><th>WR</th><th>Battles</th><th>Avg HP</th><th>Clutch</th><th>Dom.</th><th>Cost</th>';
  BUDGETS.forEach(b=>{ topTeamsHtml+='<th>'+b+'g</th>'; });
  topTeamsHtml+='</tr></thead><tbody>';
  top15.forEach((tr,i)=>{
    const total=tr.wins+tr.losses;
    const wr=tr.wins/total;
    const avgHp=(tr.totalPhp/total).toFixed(0);
    const cost=tr.team.reduce((s,id)=>s+uLook(id).cost,0);
    const clutchPct=tr.wins>0?pct(tr.clutchWins/tr.wins):'—';
    const domPct=tr.wins>0?pct(tr.dominantWins/tr.wins):'—';
    const rp=tr.refinePasses||0;
    const rb=rp>=4?'<span class="badge bl-b" title="'+total.toLocaleString()+' battles">★★★</span> ':rp>=3?'<span class="badge ye-b" title="'+total.toLocaleString()+' battles">★★</span> ':rp>=2?'<span class="badge" style="background:#1a1a3d;color:#8080ff">★</span> ':'';
    const ub=tr.losses===0?'<span class="badge gr-b">✨</span> ':'';
    const teamPageId='team-'+tr.team.slice().sort().join('-').replace(/[^a-z0-9-]/g,'');
    topTeamsHtml+='<tr class="team-row" onclick="showPage(&apos;'+teamPageId+'&apos;)" style="cursor:pointer;" title="Click for team details">';
    topTeamsHtml+='<td class="dim fw">'+( i+1)+'</td>';
    topTeamsHtml+='<td>'+rb+ub+'<span class="mono">'+esc(tr.team.join(', '))+'</span> <span class="dim" style="font-size:10px">→</span></td>';
    topTeamsHtml+='<td><div class="bwrap"><div class="btrack" style="width:70px"><div class="bfill" style="width:'+Math.round(wr*100)+'%;background:'+(wr>=0.6?'var(--gr)':wr>=0.45?'var(--ye)':'var(--re)')+'"></div></div><span class="'+cc(wr)+' fw"> '+pF(wr)+'%</span></div></td>';
    topTeamsHtml+='<td class="dim">'+total.toLocaleString()+'</td>';
    topTeamsHtml+='<td>'+avgHp+'</td>';
    topTeamsHtml+='<td class="dim">'+clutchPct+'</td>';
    topTeamsHtml+='<td class="dim">'+domPct+'</td>';
    topTeamsHtml+='<td class="dim">'+cost+'g</td>';
    BUDGETS.forEach(b=>{
      const bd=tr.byBudget[b];
      if(!bd){topTeamsHtml+='<td class="dim">—</td>';return;}
      const bwr=bd.wins/(bd.wins+bd.losses);
      topTeamsHtml+='<td class="'+cc(bwr)+'">'+pF(bwr)+'%</td>';
    });
    topTeamsHtml+='</tr>';
  });
  topTeamsHtml+='</tbody></table></div>';
  if(undefeated.length){
    topTeamsHtml+='<h3 style="margin-top:1.5rem;margin-bottom:.6rem">✨ Undefeated Teams</h3>';
    undefeated.slice(0,10).forEach(tr=>{
      const total=tr.wins+tr.losses;
      topTeamsHtml+='<div class="unbeaten"><span class="badge gr-b">Undefeated</span> <span class="mono">'+esc(tr.team.join(', '))+'</span><span class="dim" style="float:right">'+total.toLocaleString()+' battles</span></div>';
    });
  }
  topTeamsHtml+='</div>';

  // unit stats page
  let unitStatsHtml='<div class="page" id="unit-stats"><h2>Unit Statistics</h2>';
  unitStatsHtml+='<div class="tab-bar" id="tbg-unit-stats">';
  unitStatsHtml+='<button class="tbtn active" data-tab="us-overview" data-group="tbg-unit-stats">Overview</button>';
  unitStatsHtml+='<button class="tbtn" data-tab="us-costeff" data-group="tbg-unit-stats">Cost Efficiency</button>';
  unitStatsHtml+='<button class="tbtn" data-tab="us-feel" data-group="tbg-unit-stats">Match Feel</button>';
  unitStatsHtml+='</div>';
  // overview tab
  unitStatsHtml+='<div class="tab-pane active" id="us-overview">';
  unitStatsHtml+='<p class="note">Win rate of all teams including this unit. Click a unit name to open its full profile.</p>';
  unitStatsHtml+='<div class="tbl-wrap"><table><thead><tr><th>#</th><th>Unit</th><th>Cost</th><th>Win Rate</th><th>Bar</th><th>Avg HP (wins)</th><th>Survival</th><th>Apps</th></tr></thead><tbody>';
  unitDetails.forEach((u,i)=>{
    if(!u.apps) return;
    unitStatsHtml+='<tr>';
    unitStatsHtml+='<td class="dim">'+( i+1)+'</td>';
    unitStatsHtml+='<td><a href="#" class="unit-link fw '+cc(u.wr)+'" data-unit="'+u.id+'">'+( u.displayName||u.id)+'</a></td>';
    unitStatsHtml+='<td class="dim">'+u.cost+'g</td>';
    unitStatsHtml+='<td class="'+cc(u.wr)+' fw">'+pct(u.wr)+'</td>';
    unitStatsHtml+='<td><div class="btrack" style="width:100px"><div class="bfill" style="width:'+Math.round(u.wr*100)+'%;background:'+(u.wr>=0.6?'var(--gr)':u.wr>=0.45?'var(--ye)':'var(--re)')+'"></div></div></td>';
    unitStatsHtml+='<td>'+(u.avgPhp!=null?u.avgPhp.toFixed(0):'—')+'</td>';
    unitStatsHtml+='<td>'+(u.survRate!=null?pct(u.survRate):'—')+'</td>';
    unitStatsHtml+='<td class="dim">'+u.apps.toLocaleString()+'</td>';
    unitStatsHtml+='</tr>';
  });
  unitStatsHtml+='</tbody></table></div></div>';
  // cost eff tab
  unitStatsHtml+='<div class="tab-pane" id="us-costeff">';
  unitStatsHtml+='<p class="note">Win rate divided by gold cost. High numbers on cheap units = potentially overtuned.</p>';
  unitStatsHtml+='<div class="tbl-wrap"><table><thead><tr><th>Unit</th><th>Cost</th><th>Win Rate</th><th>Efficiency</th><th>Bar</th><th>Verdict</th></tr></thead><tbody>';
  [...unitDetails].sort((a,b)=>b.costEff-a.costEff).filter(u=>u.apps>0).forEach(u=>{
    const eff=u.costEff;
    const verdict=eff>0.12?'<span class="badge re-b">May be OP</span>':eff>0.10?'<span class="badge ye-b">Strong</span>':eff>0.07?'<span class="badge gr-b">Balanced</span>':'<span class="badge bl-b">Undertuned?</span>';
    unitStatsHtml+='<tr>';
    unitStatsHtml+='<td><a href="#" class="unit-link fw" data-unit="'+u.id+'">'+( u.displayName||u.id)+'</a></td>';
    unitStatsHtml+='<td class="dim">'+u.cost+'g</td>';
    unitStatsHtml+='<td class="'+cc(u.wr)+'">'+pct(u.wr)+'</td>';
    unitStatsHtml+='<td class="fw">'+(eff*100).toFixed(2)+'</td>';
    unitStatsHtml+='<td><div class="btrack" style="width:100px"><div class="bfill" style="width:'+Math.min(100,Math.round(eff*700))+'%;background:'+(eff>0.12?'var(--re)':eff>0.09?'var(--ye)':'var(--gr)')+'"></div></div></td>';
    unitStatsHtml+='<td>'+verdict+'</td></tr>';
  });
  unitStatsHtml+='</tbody></table></div></div>';
  // match feel tab
  unitStatsHtml+='<div class="tab-pane" id="us-feel">';
  unitStatsHtml+='<p class="note">What kind of victories does this unit produce? Clutch = won with base HP below 30. Dominant = HP above 70.</p>';
  unitStatsHtml+='<div class="tbl-wrap"><table><thead><tr><th>Unit</th><th>Clutch %</th><th>Dominant %</th><th>Feel</th></tr></thead><tbody>';
  unitDetails.filter(u=>u.clutchRate!=null&&unitClutchN[u.id]>5&&u.apps>0).forEach(u=>{
    const c=u.clutchRate, d=u.domRate;
    const feel=d>0.6?'<span class="badge gr-b">Snowball</span>':c>0.3?'<span class="badge ye-b">Tense</span>':'<span class="badge bl-b">Balanced</span>';
    unitStatsHtml+='<tr>';
    unitStatsHtml+='<td><a href="#" class="unit-link fw" data-unit="'+u.id+'">'+( u.displayName||u.id)+'</a></td>';
    unitStatsHtml+='<td class="'+(c>0.25?'ye':'dim')+'">'+pct(c)+'</td>';
    unitStatsHtml+='<td class="'+(d>0.5?'gr':'dim')+'">'+pct(d)+'</td>';
    unitStatsHtml+='<td>'+feel+'</td></tr>';
  });
  unitStatsHtml+='</tbody></table></div></div>';
  unitStatsHtml+='</div>';

  // matchups page
  let matchupsHtml='<div class="page" id="matchups"><h2>Matchup Analysis</h2>';
  matchupsHtml+='<div class="cols2">';
  matchupsHtml+='<div><h3>Worst pairs to run together</h3><p class="note">These combos consistently underperform.</p>';
  matchupsHtml+='<table><thead><tr><th>Pair</th><th>Win Rate</th><th>Apps</th></tr></thead><tbody>';
  worstPairs.forEach(p=>{
    matchupsHtml+='<tr><td class="mono">'+esc(p.pair)+'</td><td class="re fw">'+pct(p.wr)+'</td><td class="dim">'+p.apps+'</td></tr>';
  });
  matchupsHtml+='</tbody></table></div>';
  matchupsHtml+='<div><h3>Team size win rates</h3><p class="note">Does the meta favour large or small rosters?</p>';
  matchupsHtml+='<table><thead><tr><th>Distinct unit types</th><th>Win Rate</th><th>Bar</th></tr></thead><tbody>';
  Object.entries(sizeWr).filter(([,v])=>v.t>0).forEach(([sz,v])=>{
    const wr=v.w/v.t;
    matchupsHtml+='<tr><td>'+sz+' type'+(sz>1?'s':'')+'</td><td class="'+cc(wr)+' fw">'+pct(wr)+'</td>';
    matchupsHtml+='<td><div class="btrack" style="width:80px"><div class="bfill" style="width:'+Math.round(wr*100)+'%;background:'+(wr>=0.6?'var(--gr)':wr>=0.45?'var(--ye)':'var(--re)')+'"></div></div></td></tr>';
  });
  matchupsHtml+='</tbody></table>';
  const dupV2=dupWr.dup.t>0?dupWr.dup.w/dupWr.dup.t:0, uniqV2=dupWr.uniq.t>0?dupWr.uniq.w/dupWr.uniq.t:0;
  matchupsHtml+='<h3 style="margin-top:1.2rem">Duplicate stacking</h3>';
  matchupsHtml+='<table><thead><tr><th>Type</th><th>Win Rate</th></tr></thead><tbody>';
  matchupsHtml+='<tr><td>All unique units</td><td class="'+cc(uniqV2)+' fw">'+pct(uniqV2)+'</td></tr>';
  matchupsHtml+='<tr><td>Has duplicates</td><td class="'+cc(dupV2)+' fw">'+pct(dupV2)+'</td></tr>';
  matchupsHtml+='</tbody></table></div></div></div>';

  // pairs page
  let pairsHtml='<div class="page" id="pairs"><h2>Unit Pair Analysis</h2>';
  pairsHtml+='<div class="tab-bar" id="tbg-pairs">';
  pairsHtml+='<button class="tbtn active" data-tab="pairs-best" data-group="tbg-pairs">Best Synergies</button>';
  pairsHtml+='<button class="tbtn" data-tab="pairs-worst" data-group="tbg-pairs">Worst Pairs</button>';
  pairsHtml+='</div>';
  pairsHtml+='<div class="tab-pane active" id="pairs-best">';
  pairsHtml+='<div class="tbl-wrap"><table><thead><tr><th>Pair</th><th>Win Rate</th><th>Bar</th><th>Apps</th></tr></thead><tbody>';
  bestPairs.forEach(p=>{
    pairsHtml+='<tr><td class="mono">'+esc(p.pair)+'</td><td class="'+cc(p.wr)+' fw">'+pct(p.wr)+'</td>';
    pairsHtml+='<td><div class="btrack" style="width:100px"><div class="bfill" style="width:'+Math.round(p.wr*100)+'%;background:var(--gr)"></div></div></td>';
    pairsHtml+='<td class="dim">'+p.apps+'</td></tr>';
  });
  pairsHtml+='</tbody></table></div></div>';
  pairsHtml+='<div class="tab-pane" id="pairs-worst">';
  pairsHtml+='<div class="tbl-wrap"><table><thead><tr><th>Pair</th><th>Win Rate</th><th>Bar</th><th>Apps</th></tr></thead><tbody>';
  worstPairs.forEach(p=>{
    pairsHtml+='<tr><td class="mono">'+esc(p.pair)+'</td><td class="re fw">'+pct(p.wr)+'</td>';
    pairsHtml+='<td><div class="btrack" style="width:100px"><div class="bfill" style="width:'+Math.round(p.wr*100)+'%;background:var(--re)"></div></div></td>';
    pairsHtml+='<td class="dim">'+p.apps+'</td></tr>';
  });
  pairsHtml+='</tbody></table></div></div></div>';

  // heatmap page
  let heatmapHtml='<div class="page" id="heatmap"><h2>Pair Heatmap</h2><p class="note">Hover a cell for the exact win rate. Green = strong synergy, Red = poor combo.</p>';
  heatmapHtml+='<div class="hm-scroll"><table class="hm"><thead><tr><th></th>';
  unitIds.forEach(id=>{ const dn=unitDisplayName[id]||id; heatmapHtml+='<th title="'+esc(dn)+'">'+esc(dn.slice(0,5))+'</th>'; });
  heatmapHtml+='</tr></thead><tbody>';
  unitIds.forEach(id1=>{
    heatmapHtml+='<tr><td class="hm-lbl">'+esc(unitDisplayName[id1]||id1)+'</td>';
    unitIds.forEach(id2=>{
      if(id1===id2){
        const wr=unitApps[id1]>0?unitWins[id1]/unitApps[id1]:null;
        heatmapHtml+='<td style="background:'+hmC(wr)+'" title="'+esc(id1)+' solo: '+(wr!=null?pct(wr):'—')+'"></td>';
      } else {
        const key=[id1,id2].sort().join('+');
        if(!pairApps[key]||pairApps[key]<5){heatmapHtml+='<td style="background:#181410" title="no data">·</td>';return;}
        const wr=pairWins[key]/pairApps[key];
        heatmapHtml+='<td style="background:'+hmC(wr)+'" title="'+esc(id1)+' + '+esc(id2)+': '+pct(wr)+'"></td>';
      }
    });
    heatmapHtml+='</tr>';
  });
  heatmapHtml+='</tbody></table></div></div>';

  // budget scaling page
  let scalingHtml='<div class="page" id="scaling"><h2>Budget Scaling</h2><p class="note">Win rate per unit vs each enemy budget. Shows which units hold up against stronger opponents.</p>';
  scalingHtml+='<div class="tbl-wrap"><table><thead><tr><th>Unit</th><th>Cost</th>';
  BUDGETS.forEach(b=>{ scalingHtml+='<th>'+b+'g<br><span style="font-size:9px;color:var(--dim)">'+DIFF[b]+'</span></th>'; });
  scalingHtml+='<th>Change</th></tr></thead><tbody>';
  unitDetails.filter(u=>u.apps>0).forEach(u=>{
    scalingHtml+='<tr><td><a href="#" class="unit-link fw" data-unit="'+u.id+'">'+( u.displayName||u.id)+'</a></td><td class="dim">'+u.cost+'g</td>';
    BUDGETS.forEach((b,bi)=>{
      const bd=unitByBudget[u.id][b];
      const wr=bd&&bd.apps>0?bd.wins/bd.apps:null;
      scalingHtml+='<td class="'+(wr!=null?cc(wr):'dim')+'">'+(wr!=null?pF(wr)+'%':'—')+'</td>';
    });
    const sc=u.scaling;
    scalingHtml+='<td class="'+(sc!=null?sgnC(sc):'dim')+' fw">'+(sc!=null?sgn(sc):'—')+'</td></tr>';
  });
  scalingHtml+='</tbody></table></div></div>';

  // units gallery page
  let unitsGalleryHtml='<div class="page" id="units"><h2>Unit Profiles</h2><p class="note">Click any unit to see full stats, radar chart, partners, and top teams.</p>';
  unitsGalleryHtml+='<div class="unit-gallery">';
  unitDetails.filter(u=>u.apps>0).forEach(u=>{
    const cls=cc(u.wr);
    unitsGalleryHtml+='<div class="ugallery-card" onclick="showUnit(\''+u.id+'\')">';
    unitsGalleryHtml+='<div class="ugallery-icon">'+esc(u.id.slice(0,2).toUpperCase())+'</div>';
    unitsGalleryHtml+='<div class="ugallery-name">'+(u.displayName||u.id)+'</div>';
    unitsGalleryHtml+='<div class="ugallery-cost">'+u.cost+'g</div>';
    unitsGalleryHtml+='<div class="'+cls+' fw ugallery-wr">'+pct(u.wr)+'</div>';
    unitsGalleryHtml+='<div class="btrack" style="width:100%;margin-top:6px"><div class="bfill" style="width:'+Math.round(u.wr*100)+'%;background:'+(u.wr>=0.6?'var(--gr)':u.wr>=0.45?'var(--ye)':'var(--re)')+'"></div></div>';
    unitsGalleryHtml+='</div>';
  });
  unitsGalleryHtml+='</div></div>';

  // ── assemble full HTML ────────────────────────────────────────────────────────
  // ── Playoff page HTML ──────────────────────────────────────────────────────
  let playoffHtml='';
  if(playoffStandings&&playoffStandings.length){
    playoffHtml='<div class="page" id="playoff"><h2>Top-10 Playoff</h2>';
    playoffHtml+='<p class="note">Round-robin: every top-10 team plays every other team best-of-10. This is the highest-confidence ranking in the report.</p>';
    // Standings table
    playoffHtml+='<h3 style="margin-bottom:.6rem">Final Standings</h3>';
    playoffHtml+='<div class="tbl-wrap"><table><thead><tr><th>Rank</th><th>Team</th><th>Match W</th><th>Match L</th><th>Game W</th><th>Game L</th><th>Game WR</th></tr></thead><tbody>';
    playoffStandings.forEach((s,i)=>{
      const gwr=s.gameWins/(s.gameWins+s.gameLosses||1);
      const keyT=[...s.team].sort().join(',');
      // Find wins/losses breakdown
      const beatTeams=[], lostTeams=[];
      Object.values(playoffResults).forEach(m=>{
        const kA=[...m.teamA].sort().join(','),kB=[...m.teamB].sort().join(',');
        if(kA===keyT&&m.winsA>m.winsB) beatTeams.push(m.teamB.join(', '));
        else if(kA===keyT&&m.winsB>m.winsA) lostTeams.push(m.teamB.join(', '));
        else if(kB===keyT&&m.winsB>m.winsA) beatTeams.push(m.teamA.join(', '));
        else if(kB===keyT&&m.winsA>m.winsB) lostTeams.push(m.teamA.join(', '));
      });
      const pid='pof-'+i;
      playoffHtml+='<tr class="po-row" data-pid="'+pid+'" style="cursor:pointer">';
      playoffHtml+='<td class="dim fw">'+(i===0?'🥇':i===1?'🥈':i===2?'🥉':'#'+(i+1))+'</td>';
      playoffHtml+='<td class="mono">'+esc(s.team.join(', '))+'</td>';
      playoffHtml+='<td class="gr fw" title="Click to see who they beat">'+s.matchWins+' W</td>';
      playoffHtml+='<td class="re" title="Click to see who beat them">'+s.matchLosses+' L</td>';
      playoffHtml+='<td class="gr">'+s.gameWins+'</td>';
      playoffHtml+='<td class="re">'+s.gameLosses+'</td>';
      playoffHtml+='<td class="'+cc(gwr)+' fw">'+pct(gwr)+'</td>';
      playoffHtml+='</tr>';
      // Expandable detail row
      playoffHtml+='<tr id="'+pid+'" style="display:none"><td colspan="7" style="padding:.5rem 1rem;background:#150f08">';
      if(beatTeams.length) playoffHtml+='<div class="gr" style="font-size:12px;margin-bottom:.3rem">✓ Beat: '+beatTeams.map(t=>'<span class="mono">'+esc(t)+'</span>').join(', ')+'</div>';
      if(lostTeams.length) playoffHtml+='<div class="re" style="font-size:12px">✗ Lost to: '+lostTeams.map(t=>'<span class="mono">'+esc(t)+'</span>').join(', ')+'</div>';
      if(!beatTeams.length&&!lostTeams.length) playoffHtml+='<div class="dim" style="font-size:12px">No match data</div>';
      playoffHtml+='</td></tr>';
    });
    playoffHtml+='</tbody></table></div>';
    // Head-to-head results
    playoffHtml+='<h3 style="margin-top:1.5rem;margin-bottom:.6rem">Head-to-Head Results</h3>';
    playoffHtml+='<div class="tbl-wrap"><table><thead><tr><th>Match</th><th>Score</th><th>Winner</th></tr></thead><tbody>';
    // Sort by most decisive win first
    Object.values(playoffResults).sort((a,b)=>Math.abs(b.winsA-b.winsB)-Math.abs(a.winsA-a.winsB)).forEach(m=>{
      const winner=m.winsA>m.winsB?'A':m.winsB>m.winsA?'B':null;
      const winTeam=winner==='A'?m.teamA:winner==='B'?m.teamB:null;
      const loseTeam=winner==='A'?m.teamB:winner==='B'?m.teamA:null;
      const winScore=winner==='A'?m.winsA:winner==='B'?m.winsB:m.winsA;
      const loseScore=winner==='A'?m.winsB:winner==='B'?m.winsA:m.winsB;
      playoffHtml+='<tr>';
      if(winner){
        playoffHtml+='<td class="gr fw mono" style="font-size:11px;text-align:right">'+esc(winTeam.join(', '))+'</td>';
        playoffHtml+='<td class="fw" style="text-align:center;padding:0 12px;white-space:nowrap">'+winScore+' – '+loseScore+'</td>';
        playoffHtml+='<td class="re mono" style="font-size:11px">'+esc(loseTeam.join(', '))+'</td>';
      } else {
        playoffHtml+='<td class="mono" style="font-size:11px;text-align:right">'+esc(m.teamA.join(', '))+'</td>';
        playoffHtml+='<td class="dim fw" style="text-align:center;padding:0 12px">'+m.winsA+' – '+m.winsB+'</td>';
        playoffHtml+='<td class="mono" style="font-size:11px">'+esc(m.teamB.join(', '))+'</td>';
      }
      playoffHtml+='</tr>';
    });
    playoffHtml+='</tbody></table></div>';
    playoffHtml+='</div>';
  }

  const html=[
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>Warfront Report</title>',
    '<style>',
    ':root{',
    '  --bg:#0f0c09;--card:#1a1610;--card2:#201c16;--border:#3a3028;',
    '  --gold:#c9a84c;--gold2:#e8d5a3;--text:#f2ead8;--dim:#7a6e60;',
    '  --gr:#4caf50;--ye:#e8a020;--re:#e53935;--bl:#4a9eff;',
    '  --sidebar:220px;',
    '}',
    '*{box-sizing:border-box;margin:0;padding:0;}',
    'body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px;line-height:1.6;display:flex;min-height:100vh;}',
    'a{color:var(--gold);text-decoration:none;}',
    // Sidebar
    '.sidebar{width:var(--sidebar);background:var(--card);border-right:1px solid var(--border);display:flex;flex-direction:column;position:fixed;top:0;left:0;bottom:0;overflow-y:auto;z-index:100;}',
    '.sidebar-logo{padding:1.2rem 1.4rem .8rem;border-bottom:1px solid var(--border);}',
    '.sidebar-logo h1{font-family:Georgia,serif;font-size:18px;color:var(--gold);letter-spacing:2px;}',
    '.sidebar-logo .meta{font-size:10px;color:var(--dim);margin-top:3px;line-height:1.4;}',
    '.nav-section{padding:.6rem 0;}',
    '.nav-label{font-size:9px;text-transform:uppercase;letter-spacing:1px;color:var(--dim);padding:.4rem 1.4rem .2rem;}',
    '.nav-item{display:block;padding:.45rem 1.4rem;font-size:13px;color:var(--dim);cursor:pointer;border-left:2px solid transparent;transition:all .15s;}',
    '.nav-item:hover{color:var(--text);background:#201c16;}',
    '.nav-item.active{color:var(--gold);border-left-color:var(--gold);background:#2a1e08;}',
    // Main
    '.main{margin-left:var(--sidebar);flex:1;padding:2rem 2.5rem;max-width:1200px;}',
    '.page{display:none;}'.replace('none','none').replace(/none/,'none'),  // will be shown by JS
    '.page.active{display:block;}',
    '.page-header{display:flex;align-items:baseline;gap:1rem;margin-bottom:1.5rem;padding-bottom:.8rem;border-bottom:1px solid var(--border);}',
    '.page-title{font-family:Georgia,serif;font-size:22px;color:var(--gold2);}',
    '.page-sub{font-size:13px;color:var(--dim);}',
    '.back-btn{padding:4px 12px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--dim);cursor:pointer;font-size:12px;white-space:nowrap;}',
    '.back-btn:hover{color:var(--gold);border-color:var(--gold);}',
    'h2{font-family:Georgia,serif;font-size:18px;color:var(--gold2);margin-bottom:.8rem;}',
    'h3{font-size:11px;font-weight:600;color:var(--gold2);text-transform:uppercase;letter-spacing:.6px;margin-bottom:.5rem;}',
    '.note{font-size:11px;color:var(--dim);margin-bottom:1rem;font-style:italic;}',
    // Tables
    '.tbl-wrap{overflow-x:auto;}',
    'table{width:100%;border-collapse:collapse;font-size:13px;}',
    'th{text-align:left;padding:6px 10px;border-bottom:1px solid var(--border);color:var(--dim);font-weight:400;font-size:11px;text-transform:uppercase;letter-spacing:.4px;white-space:nowrap;}',
    'td{padding:6px 10px;border-bottom:1px solid #18140f;vertical-align:middle;}',
    'tr:hover td{background:#1e1a14;}',
    // Colours
    '.gr{color:var(--gr);}.ye{color:var(--ye);}.re{color:var(--re);}.bl{color:var(--bl);}.dim{color:var(--dim);}.fw{font-weight:600;}',
    // Bars
    '.bwrap{display:flex;align-items:center;gap:6px;}',
    '.btrack{height:7px;background:#111;border-radius:4px;overflow:hidden;flex-shrink:0;}',
    '.bfill{height:100%;border-radius:4px;transition:width .3s;}',
    // Badges
    '.badge{display:inline-block;font-size:10px;padding:1px 7px;border-radius:3px;font-weight:600;margin-right:3px;}',
    '.gr-b{background:#0d3d1a;color:var(--gr);}.re-b{background:#3d0d0d;color:var(--re);}.ye-b{background:#3a2a00;color:var(--ye);}.bl-b{background:#0d1f3d;color:var(--bl);}',
    // Insight
    '.insight{background:#1a1608;border-left:3px solid var(--gold);padding:.7rem 1rem;font-size:13px;color:var(--gold2);margin-bottom:.8rem;border-radius:0 6px 6px 0;line-height:1.6;}',
    // Tabs
    '.tab-bar{display:flex;gap:4px;margin-bottom:1rem;flex-wrap:wrap;}',
    '.tbtn{padding:5px 14px;border-radius:5px;border:1px solid var(--border);background:transparent;color:var(--dim);cursor:pointer;font-size:12px;font-family:inherit;transition:all .15s;}',
    '.tbtn:hover{color:var(--text);border-color:var(--gold);}',
    '.tbtn.active{background:#2a1e08;color:var(--gold);border-color:var(--gold);}',
    '.tab-pane{display:none;}.tab-pane.active{display:block;}',
    '.team-row:hover td{background:#2a1e08!important;}',
    // Unit gallery
    '.unit-gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:.75rem;}',
    '.ugallery-card{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:1rem;cursor:pointer;transition:border-color .15s;text-align:center;}',
    '.ugallery-card:hover{border-color:var(--gold);background:#201c16;}',
    '.ugallery-icon{width:44px;height:44px;background:#2a1e08;border:1px solid var(--gold);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto .5rem;font-family:Georgia,serif;font-size:15px;color:var(--gold2);}',
    '.ugallery-name{font-size:12px;font-weight:600;color:var(--gold2);margin-bottom:2px;}',
    '.ugallery-cost{font-size:11px;color:var(--dim);}',
    '.ugallery-wr{font-size:14px;margin-top:.3rem;}',
    // Unit detail
    '.unit-detail-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:1rem;}',
    '@media(max-width:900px){.unit-detail-grid{grid-template-columns:1fr;}}',
    '.ucard{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:1rem 1.1rem;}',
    '.radar-wrap{display:flex;justify-content:center;margin-bottom:.8rem;}',
    '.mini-tbl{width:100%;font-size:12px;border-collapse:collapse;}',
    '.mini-tbl td{padding:3px 4px;border-bottom:1px solid #1e1a14;}',
    '.mini-tbl td:first-child{color:var(--dim);width:55%;}',
    '.mini-tbl th{font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:.4px;padding:3px 4px;text-align:left;font-weight:400;}',
    '.mono{font-family:monospace;font-size:12px;color:var(--gold2);}',
    // Heatmap
    '.hm-scroll{overflow-x:auto;margin-top:.5rem;}',
    '.hm{border-collapse:collapse;font-size:9px;}',
    '.hm th{writing-mode:vertical-rl;min-width:20px;padding:3px 2px;color:var(--dim);font-weight:400;font-size:9px;border:none;background:none;}',
    '.hm td{width:20px;height:20px;border:1px solid var(--bg);}',
    '.matchup-section{margin-top:1.2rem;padding-top:.8rem;border-top:1px solid var(--stone-light);}'+
    '.matchup-label{font-family:"Cinzel",serif;font-size:10px;letter-spacing:.5px;text-transform:uppercase;margin:.5rem 0 .3rem;}'+
    '.matchup-label.bad{color:#e06060;}.matchup-label.good{color:#60b060;}'+
    '.matchup-chip{display:inline-block;margin:2px 4px 2px 0;padding:2px 8px;border-radius:4px;font-size:11px;}'+
    '.matchup-chip.bad{background:rgba(200,60,60,.15);border:1px solid rgba(200,60,60,.3);color:#e08080;}'+
    '.matchup-chip.good{background:rgba(60,160,60,.15);border:1px solid rgba(60,160,60,.3);color:#80c080;}'+
    '.hm-lbl{writing-mode:horizontal-tb!important;text-align:right;padding-right:6px!important;min-width:80px;color:var(--dim);font-size:10px;}',
    // Cols
    '.cols2{display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;}',
    '@media(max-width:700px){.cols2{grid-template-columns:1fr;}}',
    // Unbeaten
    '.unbeaten{background:#0a2014;border:1px solid #1a5030;border-radius:6px;padding:.6rem .9rem;margin-bottom:.4rem;}',
    '</style>',
    '</head>',
    '<body>',
    // Sidebar
    '<nav class="sidebar">',
    '<div class="sidebar-logo">',
    '<h1>⚔ WARFRONT</h1>',
    '<div class="meta">'+totalBattles.toLocaleString()+' battles<br>'+sorted.length+' teams · '+elapsed+'s</div>',
    '</div>',
    '<div class="nav-section">',
    '<div class="nav-label">Overview</div>',
    '<div class="nav-item active" data-page="insights">💡 Insights</div>',
    '<div class="nav-item" data-page="top-teams">🏆 Top Teams</div>',
    '</div>',
    '<div class="nav-section">',
    '<div class="nav-label">Units</div>',
    '<div class="nav-item" data-page="unit-stats">📊 Unit Stats</div>',
    '<div class="nav-item" data-page="units">🧬 Profiles</div>',
    '<div class="nav-item" data-page="scaling">📈 Scaling</div>',
    '</div>',
    '<div class="nav-section">',
    '<div class="nav-label">Analysis</div>',
    '<div class="nav-item" data-page="pairs">🤝 Pairs</div>',
    '<div class="nav-item" data-page="matchups">⚔ Matchups</div>',
    '<div class="nav-item" data-page="heatmap">🔥 Heatmap</div>',
    '</div>',
    playoffStandings?'<div class="nav-section"><div class="nav-label">Playoff</div><div class="nav-item" data-page="playoff">🏅 Top-10 Playoff</div></div>':'',
    '</nav>',
    // Main
    '<main class="main">',
    insightsHtml,
    topTeamsHtml,
    unitStatsHtml,
    unitsGalleryHtml,
    unitPages,
    scalingHtml,
    pairsHtml,
    matchupsHtml,
    heatmapHtml,
    teamDetailPages,
    playoffHtml,
    '</main>',
    // JS — no inline event handlers, no template literal parsing issues
    '<script>',
    '(function(){',
    '  document.addEventListener("click",function(e){var row=e.target.closest(".po-row");if(row){var pid=row.dataset.pid;var el=document.getElementById(pid);if(el)el.style.display=el.style.display==="none"||!el.style.display?"table-row":"none";}});',
    // Page navigation — clears ALL pages (both class and inline style)
    '  function showPage(id){',
    '    document.querySelectorAll(".page").forEach(function(p){',
    '      p.classList.remove("active");',
    '      p.style.display="";',  // clear any inline display set by showUnit
    '    });',
    '    var p=document.getElementById(id);',
    '    if(p){ p.classList.add("active"); p.style.display=""; }',
    '    document.querySelectorAll(".nav-item").forEach(function(n){',
    '      n.classList.toggle("active",n.dataset.page===id);',
    '    });',
    '    window._currentPage=id;',
    '  }',
    '  window.showPage=showPage;',
    // Unit page — only use class, never inline style
    '  function showUnit(id){',
    '    document.querySelectorAll(".page").forEach(function(p){',
    '      p.classList.remove("active");',
    '      p.style.display="";',
    '    });',
    '    var p=document.getElementById("unit-"+id);',
    '    if(p) p.classList.add("active");',
    '    document.querySelectorAll(".nav-item").forEach(function(n){',
    '      n.classList.toggle("active",n.dataset.page==="units");',
    '    });',
    '  }',
    '  window.showUnit=showUnit;',
    // Nav items
    '  document.querySelectorAll(".nav-item[data-page]").forEach(function(el){',
    '    el.addEventListener("click",function(){ showPage(this.dataset.page); });',
    '  });',
    // Unit links
    '  document.addEventListener("click",function(e){',
    '    var el=e.target.closest(".unit-link");',
    '    if(el){ e.preventDefault(); showUnit(el.dataset.unit); }',
    '  });',
    // Tab buttons — scope to nearest .page ancestor for isolation
    '  document.querySelectorAll(".tbtn").forEach(function(btn){',
    '    btn.addEventListener("click",function(){',
    '      var tabId=this.dataset.tab;',
    '      // Find the containing page/section (walk up until .page or .main)',
    '      var container=this.parentElement;',
    '      while(container&&!container.classList.contains("page")&&container.tagName!=="MAIN"){',
    '        container=container.parentElement;',
    '      }',
    '      if(!container) return;',
    '      // Deactivate all tabs and panes within this container',
    '      container.querySelectorAll(".tbtn").forEach(function(b){ b.classList.remove("active"); });',
    '      container.querySelectorAll(".tab-pane").forEach(function(p){ p.classList.remove("active"); });',
    '      // Activate clicked tab and target pane',
    '      this.classList.add("active");',
    '      var pane=document.getElementById(tabId);',
    '      if(pane) pane.classList.add("active");',
    '    });',
    '  });',
    // Show first page
    '  showPage("insights");',
    '  // Unit pages start with display:none via .page CSS rule — no extra reset needed',
    '})();',
    '</script>',
    '</body>',
    '</html>'
  ].join('\n');

  fs.writeFileSync(path.resolve(outFile), html, 'utf8');
  console.log('\n\u{1F4C4} HTML report: '+path.resolve(outFile));
  console.log('   Open: file://'+path.resolve(outFile)+'\n');
}