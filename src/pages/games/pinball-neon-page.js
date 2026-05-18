/**
 * pinball-neon-page.js
 * Complete ground-up pinball game with proper physics, 5 themed emoji maps,
 * shooter lane plunger, dual flippers, and futuristic neon visuals.
 * Built from scratch — no legacy code.
 */
import { h, mount } from '../../utils/dom.js';
import { appShell } from '../../ui/layout/app-shell.js';
import { createBetInput } from '../../ui/components/bet-input.js';
import { userStore, patchProfile } from '../../state/user-store.js';
import { toastError, toastSuccess } from '../../ui/components/toast.js';
import { validateBet } from '../../utils/validation.js';
import { formatCredits } from '../../utils/format.js';
import {
  flashGold,
  flashLossMajor,
  flashSuccessMajor,
  flashStreakText,
} from '../../ui/fx/feedback-fx.js';
import { GAMES } from '../../config/constants.js';
import { startPinballRound, settlePinballRound } from '../../games/pinball/pinball-api.js';
import {
  PINBALL_BALL_OPTIONS,
  PINBALL_MAPS,
  comboPopupFor,
  pinballMapByKey,
} from '../../games/pinball/pinball-maps.js';
import { createPinballSpecials } from '../../games/pinball/pinball-specials.js';

/* ═══════════════════════════════════════════════════════════════════════════
   PHYSICS CONSTANTS
   Board is normalized: playfield x[0..1] y[0..1], launcher lane x[1..~1.1]
   Aspect ratio: the canvas is drawn ~0.5:1 (width:height) like a real table.
   ═══════════════════════════════════════════════════════════════════════════ */
const BALL_R       = 0.013;
const GRAVITY_BASE = 0.72;
const MAX_VEL      = 2.2;
const RESTITUTION  = 0.62;
const WALL_REST    = 0.40;
const TRAIL_LEN    = 12;
const PHYS_SUBSTEPS = 4;

const COMBO_WINDOW = 1200;
const RESPAWN_MS   = 600;
const STUCK_NUDGE  = 500;
const STUCK_HARD   = 1400;
const MAX_CHARGE   = 1000;
const LAUNCH_MIN   = 0.40;
const LAUNCH_MAX   = 1.20;

// Flipper pivots are set INSIDE the angled gutter walls so the flipper
// body overlaps the gutter-to-drain junction.  This eliminates the corner
// where balls used to get trapped.  Flippers are lengthened to keep the
// drain gap between tips at rest roughly the same (~0.09).
const FLIP_LEN     = 0.16;
const FLIP_THICK   = 0.015;
const FLIP_REST_A  = -0.20;
const FLIP_HIT_A   = 0.65;
const FLIP_SPEED   = 18;
const FLIP_Y       = 0.90;
const FLIP_LX      = 0.30;
const FLIP_RX      = 0.70;

// Ball spawns at top-center, drops with random X direction
const SPAWN_X      = 0.50;
const SPAWN_Y      = 0.04;

// Drain walls match flipper pivots
const DRAIN_LEFT   = 0.30;
const DRAIN_RIGHT  = 0.70;
const DRAIN_Y      = 0.95;

const PF_LEFT      = 0.0;
const PF_RIGHT     = 1.0;
const PF_TOP       = 0.0;
const PF_BOT       = 1.0;

/* ═══════════════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function rand(lo, hi) { return lo + Math.random() * (hi - lo); }
function dist(ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); }
function hex2rgba(hex, a) {
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function closestOnSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy || 1;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / lenSq, 0, 1);
  return { x: ax + dx * t, y: ay + dy * t };
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN RENDER
   ═══════════════════════════════════════════════════════════════════════════ */
export function renderPinball(ctx) {
  const isMobile = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches;

  /* ── DOM ── */
  const root = h('div.flex.flex-col.gap-5.overflow-hidden.pb-4', {
    style: { minHeight: 'calc(100vh - 112px)' },
  }, []);

  const canvas = h('canvas', {
    tabindex: '0',
    style: {
      display: 'block',
      width: '100%',
      height: '100%',
      touchAction: 'none',
      borderRadius: '18px',
    },
  });

  const popLayer = h('div.absolute.inset-0.pointer-events-none.overflow-hidden');

  const cabinet = h('div.relative.mx-auto', {
    style: {
      width: 'min(420px, 90vw)',
      height: 'min(840px, 80vh)',
      minHeight: '500px',
      borderRadius: '22px',
      border: '2px solid rgba(255,255,255,0.08)',
      background: '#030812',
      boxShadow: '0 0 80px rgba(0,0,0,0.6), inset 0 0 40px rgba(0,0,0,0.4)',
      overflow: 'hidden',
    },
  }, [canvas, popLayer]);

  const bet = createBetInput({ value: 25, min: GAMES.PINBALL?.minBet ?? 10 });

  /* ── STATE ── */
  let mode = 'pregame';       // pregame | playing | result
  let currentMap = PINBALL_MAPS[0];
  let round = null;
  let roundRunning = false;
  let roundSettling = false;
  let launchBusy = false;
  let roundOutcome = null;
  let ballChoice = PINBALL_BALL_OPTIONS[0];

  let score = 0;
  let combo = 0;
  let comboMax = 0;
  let lastHitAt = 0;
  let bumperHits = 0;
  let targetHits = 0;
  let drainCount = 0;

  let ballsTotal = 0;
  let ballsLeft = 0;
  let activeBalls = [];
  let ballSeq = 0;
  let specialScript = null;

  let flipLAngle = FLIP_REST_A;
  let flipRAngle = FLIP_REST_A;
  let prevFlipLAngle = FLIP_REST_A;
  let prevFlipRAngle = FLIP_REST_A;
  let flipLTarget = FLIP_REST_A;
  let flipRTarget = FLIP_REST_A;
  let leftHeld = false;
  let rightHeld = false;

  let charging = false;
  let chargeStart = 0;
  let chargeVal = 0;

  let rafId = null;
  let lastTs = 0;
  let cW = 0, cH = 0;
  let pfW = 0, pfH = 0, pfX = 0, pfY = 0;
  let ctx2d = null;
  let resizeObs = null;
  const popTimers = new Set();
  let trembleUntil = 0;
  let tremblePower = 0;
  let trembleDuration = 0;

  /* ── COORDINATE TRANSFORMS ── */
  // Playfield normalized → canvas pixels
  function toX(nx) { return pfX + nx * pfW; }
  function toY(ny) { return pfY + ny * pfH; }
  function toR(nr) { return nr * pfW; }
  function ballRadius(b) { return BALL_R * (b.radiusScale ?? 1); }

  function triggerTremble(power = 1, duration = 180) {
    const now = performance.now();
    trembleUntil = Math.max(trembleUntil, now + duration);
    tremblePower = Math.max(tremblePower, power);
    trembleDuration = Math.max(trembleDuration, duration);
  }

  function getTrembleOffset(now) {
    const remaining = trembleUntil - now;
    if (remaining <= 0 || trembleDuration <= 0) {
      trembleUntil = 0;
      tremblePower = 0;
      trembleDuration = 0;
      return { x: 0, y: 0 };
    }
    const fade = remaining / trembleDuration;
    const amp = tremblePower * fade;
    return {
      x: Math.sin(now * 0.07) * amp,
      y: Math.cos(now * 0.053) * amp * 0.7,
    };
  }

  /* ── CANVAS SIZING ── */
  function resize() {
    const rect = cabinet.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    cW = rect.width;
    cH = rect.height;
    canvas.width = Math.round(cW * dpr);
    canvas.height = Math.round(cH * dpr);
    ctx2d = canvas.getContext('2d');
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Playfield fills the full cabinet
    const margin = 8;
    pfX = margin;
    pfY = margin;
    pfW = cW - margin * 2;
    pfH = cH - margin * 2;
  }

  /* ── BALL FACTORY ── */
  function makeBall(opts = {}) {
    const x = opts.x ?? SPAWN_X;
    const y = opts.y ?? SPAWN_Y;
    return {
      id: ++ballSeq,
      x,
      y,
      vx: opts.vx ?? 0,
      vy: opts.vy ?? 0,
      alive: true,
      staged: opts.staged ?? true,
      trail: [],
      stuckTime: 0,
      lastX: x, lastY: y,
      cooldowns: new Map(),
      age: 0,
      radiusScale: opts.radiusScale ?? 1,
      scoreBoostUntil: 0,
      scoreBoostMult: 1,
      speedBoostUntil: 0,
      speedBoostMult: 1,
      sizeUntil: 0,
      glowColor: opts.glowColor ?? null,
      splitGroupId: opts.splitGroupId ?? null,
      splitAnchorX: opts.splitAnchorX ?? null,
      splitAnchorY: opts.splitAnchorY ?? null,
      regroupUntil: opts.regroupUntil ?? 0,
      mergeCooldownUntil: opts.mergeCooldownUntil ?? 0,
      _meteorFragments: opts._meteorFragments ?? null,
      sizeGrowFrom: opts.sizeGrowFrom ?? null,
      sizeGrowTo: opts.sizeGrowTo ?? null,
      sizeGrowStartAt: opts.sizeGrowStartAt ?? 0,
      sizeGrowUntil: opts.sizeGrowUntil ?? 0,
    };
  }

  function spawnBallAt(opts = {}) {
    const consumeReserve = opts.consumeReserve !== false;
    if (consumeReserve) {
      if (ballsLeft <= 0) { maybeFinish(); return null; }
      ballsLeft--;
    }
    const b = makeBall(opts);
    activeBalls.push(b);
    if (opts.staged !== false) {
      charging = false;
      chargeVal = 0;
      chargeStart = 0;
    }
    return b;
  }

  function addReserveBall(count = 1) {
    ballsLeft += count;
    ballsTotal += count;
  }

  function applyBallEffect(ball, effect, now = performance.now()) {
    if (!ball || !ball.alive) return;
    if (typeof effect.radiusScale === 'number') {
      ball.radiusScale = effect.radiusScale;
      ball.sizeUntil = effect.duration ? now + effect.duration : 0;
    }
    if (typeof effect.pointsMultiplier === 'number') {
      ball.scoreBoostMult = effect.pointsMultiplier;
      ball.scoreBoostUntil = now + (effect.duration ?? 0);
    }
    if (typeof effect.speedMultiplier === 'number') {
      ball.speedBoostMult = effect.speedMultiplier;
      ball.speedBoostUntil = now + (effect.duration ?? 0);
      ball.vx *= effect.speedMultiplier;
      ball.vy *= effect.speedMultiplier;
    }
    if (effect.color) ball.glowColor = effect.color;
  }

  /* ── GAME FLOW ── */
  function resetGameState() {
    activeBalls = [];
    score = 0; combo = 0; comboMax = 0; lastHitAt = 0;
    bumperHits = 0; targetHits = 0; drainCount = 0;
    charging = false; chargeVal = 0; chargeStart = 0;
    flipLAngle = FLIP_REST_A; flipRAngle = FLIP_REST_A;
    prevFlipLAngle = FLIP_REST_A; prevFlipRAngle = FLIP_REST_A;
    flipLTarget = FLIP_REST_A; flipRTarget = FLIP_REST_A;
    leftHeld = false; rightHeld = false;
    lastTs = 0;
    trembleUntil = 0;
    tremblePower = 0;
    trembleDuration = 0;
  }

  function spawnBall() {
    spawnBallAt({ staged: true });
  }

  function drainBall(b) {
    b.alive = false;
    if (b._meteorFragments != null) {
      showPop('☄', '#ff944d', b.x, b.y, 0.7);
      const stillAlive = activeBalls.filter(ab => ab.alive && !ab.staged);
      if (stillAlive.length === 0) {
        if (ballsLeft > 0) {
          setTimeout(() => { if (roundRunning && !roundSettling) spawnBall(); }, RESPAWN_MS);
        } else {
          maybeFinish();
        }
      }
      return;
    }
    drainCount++;
    showPop('DRAIN', '#ff6b8a', b.x, b.y, 1.1);
    flashLossMajor({ label: 'BALL LOST' });
    if (ballsLeft > 0) {
      setTimeout(() => { if (roundRunning && !roundSettling) spawnBall(); }, RESPAWN_MS);
    } else {
      maybeFinish();
    }
  }

  async function launchRound() {
    if (roundRunning || roundSettling || launchBusy) return;
    const amount = bet.get();
    const credits = userStore.get().profile?.credits ?? 0;
    const err = validateBet(amount * ballChoice, credits);
    if (err) return toastError(err);

    launchBusy = true;
    redraw();

    try {
      const result = await startPinballRound(amount, ballChoice);
      round = result;
      currentMap = pinballMapByKey(result.mapKey);
      specialScript = createPinballSpecials(result.mapKey);
      specialScript.reset();
      mode = 'playing';
      roundOutcome = null;
      resetGameState();
      roundRunning = true;
      ballsTotal = result.ballCount;
      ballsLeft = result.ballCount;
      if (typeof result.newBalance === 'number') patchProfile({ credits: result.newBalance });
      lockScroll();
      spawnBall();
      ensureLoop();
      redraw();
    } catch (e) {
      toastError(e.message ?? String(e));
    } finally {
      launchBusy = false;
    }
  }

  async function maybeFinish() {
    const alive = activeBalls.filter(b => b.alive);
    if (alive.length > 0 || ballsLeft > 0 || roundSettling || !round) return;
    roundSettling = true;
    redraw();

    const summary = {
      score: Math.round(score),
      combo_max: comboMax,
      bumper_hits: bumperHits,
      target_hits: targetHits,
      zone_hits: 0,
      jam_hits: 0,
      drain_hits: drainCount,
      ball_count: ballsTotal,
      map_key: currentMap.key,
    };

    try {
      const s = await settlePinballRound(round.roundId, summary);
      const stake = round.stake ?? bet.get() * ballChoice;
      const net = s.payout - stake;
      roundOutcome = {
        score: Math.round(score), comboMax, payout: s.payout,
        stake, newBalance: s.newBalance, won: net > 0,
        mapName: currentMap.name, bumperHits, targetHits, drainCount,
      };
      if (net > 0) {
        net >= stake
          ? flashGold({ label: 'PINBALL JACKPOT' })
          : flashSuccessMajor({ label: 'WIN' });
        toastSuccess(`Pinball won +${formatCredits(net)} cr`);
      } else {
        flashLossMajor({ label: 'PINBALL BUST', intense: true });
        toastError(`Pinball lost ${formatCredits(Math.abs(net))} cr`);
      }
      patchProfile({ credits: s.newBalance });
      mode = 'result';
    } catch (e) {
      toastError(e.message ?? String(e));
    } finally {
      roundRunning = false;
      roundSettling = false;
      unlockScroll();
      redraw();
    }
  }

  /* ── SCORING ── */
  function registerHit(b, pts, label, color, kind) {
    const now = performance.now();
    combo = (now - lastHitAt <= COMBO_WINDOW) ? combo + 1 : 1;
    comboMax = Math.max(comboMax, combo);
    lastHitAt = now;

    const boostMult = b?.scoreBoostUntil > now ? (b.scoreBoostMult ?? 1) : 1;
    const mult = (currentMap.scoreMultiplier ?? 1) * boostMult * (1 + Math.min(combo - 1, 12) * 0.10);
    const gained = Math.max(1, Math.round(pts * mult));
    score += gained;

    if (kind === 'bumper') bumperHits++;
    if (kind === 'target') targetHits++;

    triggerTremble(0.75 + Math.min(gained / 1500, 0.9), 150 + Math.min(combo * 12, 140));

    const pop = comboPopupFor(combo);
    if (pop) {
      showPop(`${pop.text} +${gained}`, pop.color, b.x, b.y - 0.03, 1.08 + combo * 0.07);
      if (combo >= 8) flashStreakText(pop.text, pop.color);
    } else {
      showPop(`+${gained}`, color, b.x, b.y - 0.02, 1.0);
    }
  }

  function showPop(text, color, nx, ny, scale = 1) {
    const el = h('div.absolute.font-black.uppercase.tracking-widest.select-none.pointer-events-none', {
      style: {
        left: `${clamp(nx / 1.1 * 100, 5, 95)}%`,
        top: `${clamp(ny * 100, 5, 95)}%`,
        color,
        textShadow: `0 0 14px ${color}, 0 0 38px rgba(0,0,0,0.88)`,
        transform: 'translate(-50%,-50%) scale(0.82)',
        opacity: '1',
        fontSize: `${Math.round(13 + scale * 8)}px`,
        lineHeight: '1',
        letterSpacing: '0.08em',
        whiteSpace: 'nowrap',
        transition: 'all 800ms ease-out',
        zIndex: '10',
      },
    }, [text]);
    popLayer.appendChild(el);
    requestAnimationFrame(() => {
      el.style.transform = `translate(-50%,-50%) translateY(-${24 + scale * 10}px) scale(1.16)`;
      el.style.opacity = '0';
    });
    const t = setTimeout(() => { popTimers.delete(t); el.remove(); }, 850);
    popTimers.add(t);
  }

  /* ── PHYSICS STEP ── */
  function step(dt) {
    const now = performance.now();
    const grav = GRAVITY_BASE * (currentMap.gravity ?? 1.0);
    const drag = currentMap.drag ?? 0.997;

    // Flipper animation — save previous angles for velocity calculation
    prevFlipLAngle = flipLAngle;
    prevFlipRAngle = flipRAngle;
    flipLTarget = leftHeld ? FLIP_HIT_A : FLIP_REST_A;
    flipRTarget = rightHeld ? FLIP_HIT_A : FLIP_REST_A;
    flipLAngle += (flipLTarget - flipLAngle) * Math.min(1, FLIP_SPEED * dt);
    flipRAngle += (flipRTarget - flipRAngle) * Math.min(1, FLIP_SPEED * dt);

    for (const b of activeBalls) {
      if (!b.alive) continue;

      // Staged ball — visible at top-right, pulses with charge
      if (b.staged) {
        chargeVal = charging ? clamp((now - chargeStart) / MAX_CHARGE, 0, 1) : 0;
        b.x = SPAWN_X;
        b.y = SPAWN_Y;
        b.vx = 0; b.vy = 0;
        continue;
      }

      b.age += dt;

      // Physics sub-steps reduce tunnelling through fast wall/gutter hits.
      const subDt = dt / PHYS_SUBSTEPS;
      for (let ps = 0; ps < PHYS_SUBSTEPS; ps++) {
        const t0 = ps / PHYS_SUBSTEPS;
        const t1 = (ps + 1) / PHYS_SUBSTEPS;
        const subFlipL  = prevFlipLAngle + (flipLAngle - prevFlipLAngle) * t1;
        const subPrevL   = prevFlipLAngle + (flipLAngle - prevFlipLAngle) * t0;
        const subFlipR   = prevFlipRAngle + (flipRAngle - prevFlipRAngle) * t1;
        const subPrevR   = prevFlipRAngle + (flipRAngle - prevFlipRAngle) * t0;

        b.vy += grav * subDt;
        b.vx *= Math.pow(drag, subDt * 60);
        b.vy *= Math.pow(drag, subDt * 60);

        const spd = Math.hypot(b.vx, b.vy);
        if (spd > MAX_VEL) { b.vx *= MAX_VEL / spd; b.vy *= MAX_VEL / spd; }

        b.x += b.vx * subDt;
        b.y += b.vy * subDt;

        wallBounce(b);
        pegCollisions(b, now);
        bumperCollisions(b, now);
        targetCollisions(b, now);
        slingshotCollisions(b, now);
        flipperCollision(b, 'left', subFlipL, subPrevL, subDt);
        flipperCollision(b, 'right', subFlipR, subPrevR, subDt);
        checkDrain(b);
        if (!b.alive) break;
      }

      if (!b.alive) continue;

      if (b.sizeGrowUntil && b.sizeGrowFrom != null && b.sizeGrowTo != null) {
        const total = Math.max(1, b.sizeGrowUntil - b.sizeGrowStartAt);
        const t = clamp((now - b.sizeGrowStartAt) / total, 0, 1);
        const eased = t * t * (3 - 2 * t);
        b.radiusScale = b.sizeGrowFrom + (b.sizeGrowTo - b.sizeGrowFrom) * eased;
        if (t >= 1) {
          b.radiusScale = b.sizeGrowTo;
          b.sizeGrowFrom = null;
          b.sizeGrowTo = null;
          b.sizeGrowStartAt = 0;
          b.sizeGrowUntil = 0;
        }
      } else if (b.sizeUntil && now >= b.sizeUntil) {
        b.radiusScale = 1;
        b.sizeUntil = 0;
      }

      if (b.speedBoostUntil && now >= b.speedBoostUntil) {
        b.speedBoostUntil = 0;
        b.speedBoostMult = 1;
      }

      // Trail
      b.trail.push({ x: b.x, y: b.y });
      if (b.trail.length > TRAIL_LEN) b.trail.shift();

      antiStuck(b, dt);
    }

    if (specialScript) {
      specialScript.step({
        dt,
        now,
        map: currentMap,
        balls: activeBalls,
        spawnBallAt,
        addReserveBall,
        registerHit,
        showPop,
        applyBallEffect,
        ballRadius,
      });
    }

    resolveBallBallCollisions(now);

    activeBalls = activeBalls.filter(b => b.alive);
    if (roundRunning && activeBalls.length === 0 && ballsLeft <= 0 && !roundSettling) {
      maybeFinish();
    }
  }

  /* ── WALL COLLISIONS ── */
  const GUTTER_Y = 0.72;
  const GUTTER_REST = 0.15; // Low restitution for smooth gutter sliding

  // Capsule-style collision against a line segment with proper normal reflection.
  // The ball is treated as a circle of radius `r` colliding with a zero-thickness
  // segment.  Normal is derived from ball-to-closest-point direction so endpoints
  // are handled naturally (circular contact at corners).
  function segWallBounce(b, r, rest, ax, ay, bx, by) {
    const cp = closestOnSeg(b.x, b.y, ax, ay, bx, by);
    const d = dist(b.x, b.y, cp.x, cp.y);
    if (d >= r || d < 0.0001) return;
    const nx = (b.x - cp.x) / d, ny = (b.y - cp.y) / d;
    b.x = cp.x + nx * r;
    b.y = cp.y + ny * r;
    const dot = b.vx * nx + b.vy * ny;
    if (dot < 0) {
      b.vx -= (1 + rest) * dot * nx;
      b.vy -= (1 + rest) * dot * ny;
    }
  }

  function wallBounce(b) {
    const r = ballRadius(b);

    // Top wall
    if (b.y < PF_TOP + r) { b.y = PF_TOP + r; b.vy = Math.abs(b.vy) * WALL_REST; }

    // Side walls (above gutter start)
    if (b.y <= GUTTER_Y) {
      if (b.x < PF_LEFT + r) { b.x = PF_LEFT + r; b.vx = Math.abs(b.vx) * WALL_REST; }
      if (b.x > PF_RIGHT - r) { b.x = PF_RIGHT - r; b.vx = -Math.abs(b.vx) * WALL_REST; }
    }

    // Angled gutter walls — proper segment collision with normal reflection.
    // Left:  (PF_LEFT, GUTTER_Y) → (FLIP_LX, FLIP_Y)
    // Right: (PF_RIGHT, GUTTER_Y) → (FLIP_RX, FLIP_Y)
    // Stop at FLIP_Y so the endpoint can’t push balls back up from the drain zone.
    if (b.y > GUTTER_Y && b.y <= FLIP_Y) {
      segWallBounce(b, r, GUTTER_REST, PF_LEFT, GUTTER_Y, FLIP_LX, FLIP_Y);
      segWallBounce(b, r, GUTTER_REST, PF_RIGHT, GUTTER_Y, FLIP_RX, FLIP_Y);
    }

    // Below flipper pivots: vertical walls at drain edges
    if (b.y > FLIP_Y) {
      if (b.x < DRAIN_LEFT + r) {
        b.x = DRAIN_LEFT + r;
        b.vx = Math.abs(b.vx) * WALL_REST;
      }
      if (b.x > DRAIN_RIGHT - r) {
        b.x = DRAIN_RIGHT - r;
        b.vx = -Math.abs(b.vx) * WALL_REST;
      }
    }
  }

  /* ── PEG COLLISIONS ── */
  function pegCollisions(b, now) {
    for (const p of currentMap.pegs ?? []) {
      const key = `peg:${p.x}:${p.y}`;
      if (b.cooldowns.has(key) && now - b.cooldowns.get(key) < 120) continue;
      const d = dist(b.x, b.y, p.x, p.y);
      const minD = ballRadius(b) + (p.r ?? 0.008);
      if (d >= minD || d < 0.001) continue;
      const nx = (b.x - p.x) / d, ny = (b.y - p.y) / d;
      b.x = p.x + nx * minD;
      b.y = p.y + ny * minD;
      const dot = b.vx * nx + b.vy * ny;
      b.vx -= (1 + RESTITUTION) * dot * nx;
      b.vy -= (1 + RESTITUTION) * dot * ny;
      b.cooldowns.set(key, now);
    }
  }

  /* ── BUMPER COLLISIONS ── */
  function bumperCollisions(b, now) {
    for (const bmp of currentMap.bumpers ?? []) {
      const key = `bmp:${bmp.label}`;
      if (b.cooldowns.has(key) && now - b.cooldowns.get(key) < 200) continue;
      const d = dist(b.x, b.y, bmp.x, bmp.y);
      const minD = ballRadius(b) + (bmp.r ?? 0.04);
      if (d >= minD || d < 0.001) continue;
      const nx = (b.x - bmp.x) / d, ny = (b.y - bmp.y) / d;
      b.x = bmp.x + nx * minD;
      b.y = bmp.y + ny * minD;
      const power = (bmp.power ?? 1.1) * 0.22;
      b.vx = nx * power + b.vx * 0.25;
      b.vy = ny * power + b.vy * 0.25;
      b.cooldowns.set(key, now);
      registerHit(b, bmp.pts ?? 150, bmp.label, bmp.color ?? currentMap.accent, 'bumper');
    }
  }

  /* ── TARGET COLLISIONS (circular, not flat) ── */
  function targetCollisions(b, now) {
    for (const t of currentMap.targets ?? []) {
      const key = `tgt:${t.label}`;
      if (b.cooldowns.has(key) && now - b.cooldowns.get(key) < 250) continue;
      const tr = t.r ?? 0.028;
      const d = dist(b.x, b.y, t.x, t.y);
      const minD = ballRadius(b) + tr;
      if (d >= minD || d < 0.001) continue;
      const nx = (b.x - t.x) / d, ny = (b.y - t.y) / d;
      b.x = t.x + nx * minD;
      b.y = t.y + ny * minD;
      const dot = b.vx * nx + b.vy * ny;
      b.vx -= (1 + RESTITUTION) * dot * nx;
      b.vy -= (1 + RESTITUTION) * dot * ny;
      b.cooldowns.set(key, now);
      registerHit(b, t.pts ?? 100, t.label, t.color ?? currentMap.accent, 'target');
    }
  }

  /* ── SLINGSHOT COLLISIONS (circular) ── */
  function slingshotCollisions(b, now) {
    for (const s of currentMap.slingshots ?? []) {
      const key = `sling:${s.label}`;
      if (b.cooldowns.has(key) && now - b.cooldowns.get(key) < 180) continue;
      const sr = s.r ?? 0.04;
      const d = dist(b.x, b.y, s.x, s.y);
      const minD = ballRadius(b) + sr;
      if (d >= minD || d < 0.001) continue;
      // Push ball out
      const nx = (b.x - s.x) / d, ny = (b.y - s.y) / d;
      b.x = s.x + nx * minD;
      b.y = s.y + ny * minD;
      const pow = (s.power ?? 1.2) * 0.25;
      b.vx += nx * pow;
      b.vy += ny * pow - 0.10;
      b.cooldowns.set(key, now);
      registerHit(b, 40, s.label, s.color ?? currentMap.accent, 'slingshot');
    }
  }

  function resolveBallBallCollisions(now) {
    for (let i = 0; i < activeBalls.length; i++) {
      const a = activeBalls[i];
      if (!a.alive || a.staged) continue;
      for (let j = i + 1; j < activeBalls.length; j++) {
        const b = activeBalls[j];
        if (!b.alive || b.staged) continue;

        const ar = ballRadius(a);
        const br = ballRadius(b);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const minD = ar + br;
        if (d >= minD || d < 0.0001) continue;

        const nx = dx / d;
        const ny = dy / d;
        const overlap = minD - d;

        if (a.splitGroupId && a.splitGroupId === b.splitGroupId) {
          const pull = overlap * 0.12;
          a.vx += nx * pull * 0.45;
          a.vy += ny * pull * 0.45;
          b.vx -= nx * pull * 0.45;
          b.vy -= ny * pull * 0.45;
          if (!a._meteorFragments) {
            a.vx += (a.splitAnchorX - a.x) * 0.18 * 0.001;
            a.vy += (a.splitAnchorY - a.y) * 0.18 * 0.001;
            b.vx += (b.splitAnchorX - b.x) * 0.18 * 0.001;
            b.vy += (b.splitAnchorY - b.y) * 0.18 * 0.001;
          }
          continue;
        }

        const massA = ar * ar;
        const massB = br * br;
        const massSum = massA + massB || 1;
        const aShare = massB / massSum;
        const bShare = massA / massSum;

        a.x -= nx * overlap * aShare;
        a.y -= ny * overlap * aShare;
        b.x += nx * overlap * bShare;
        b.y += ny * overlap * bShare;

        const relVn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (relVn >= 0) continue;

        const restitution = 0.82;
        const impulse = -(1 + restitution) * relVn;
        a.vx -= impulse * nx * aShare;
        a.vy -= impulse * ny * aShare;
        b.vx += impulse * nx * bShare;
        b.vy += impulse * ny * bShare;

        if (a.speedBoostUntil > now || b.speedBoostUntil > now) {
          a.glowColor = a.glowColor || currentMap.accent2 || currentMap.accent;
          b.glowColor = b.glowColor || currentMap.accent2 || currentMap.accent;
        }
      }
    }
  }

  /* ── FLIPPER COLLISION ── */
  // Inspired by Lu1ky Pinball (frankforce.com): the flipper is modelled as a
  // chain of overlapping circles along its length.  Each circle's position is
  // derived from the current flipper angle, and its velocity from the delta
  // with the previous frame's angle.
  //
  // Collision is simple circle-vs-circle.  The critical guard is the
  // "moving-toward" check (relVn < 0): the ball's velocity relative to the
  // flipper circle, projected onto the collision normal, must be negative
  // (approaching).  This single check naturally prevents:
  //   • grabbing  (ball already separating → relVn ≥ 0 → skip)
  //   • wrong-side hits (ball below flipper falling away → relVn ≥ 0 → skip)
  //   • tunnelling (multiple overlapping circles ensure no gaps)
  const FLIP_N = 9; // circles per flipper (pivot … tip inclusive)
  const FLIP_REST = 0.35;

  function flipperCollision(b, side, angle, prevAngle, dt) {
    // No cooldown — the relVn >= 0 (separating) check already prevents
    // double-hits.  Resting contact needs to fire every frame so the ball
    // stays on top of the flipper and responds when the player swings.
    const pivotX = side === 'left' ? FLIP_LX : FLIP_RX;
    const pivotY = FLIP_Y;
    const dir = side === 'left' ? 1 : -1;

    // Early-out: ball too far above flippers to possibly touch
    if (b.y < pivotY - 0.10) return;

    // Walk the circle chain; keep track of the deepest overlapping circle
    // whose "moving-toward" check passes.
    let bestOverlap = 0;
    let hitNx = 0, hitNy = 0, hitCx = 0, hitCy = 0, hitMinD = 0, hitRelVn = 0;

    for (let i = 0; i < FLIP_N; i++) {
      const t = i / (FLIP_N - 1); // 0 = pivot, 1 = tip
      const len = FLIP_LEN * t;

      // Circle position this frame
      const cx = pivotX + Math.cos(angle) * len * dir;
      const cy = pivotY - Math.sin(angle) * len;

      // Uniform radius — matches the visual round-cap lineWidth
      const minD = ballRadius(b) + FLIP_THICK;

      const d = dist(b.x, b.y, cx, cy);
      const overlap = minD - d;
      if (overlap <= 0 || d < 0.001) continue;

      // Circle position previous frame → velocity
      const pcx = pivotX + Math.cos(prevAngle) * len * dir;
      const pcy = pivotY - Math.sin(prevAngle) * len;
      const fvx = dt > 0.001 ? (cx - pcx) / dt : 0;
      const fvy = dt > 0.001 ? (cy - pcy) / dt : 0;

      // Collision normal: from flipper circle center toward ball
      const nx = (b.x - cx) / d;
      const ny = (b.y - cy) / d;

      // Relative velocity of ball w.r.t. flipper circle, along normal.
      // Negative = approaching, Positive = separating.
      const relVn = (b.vx - fvx) * nx + (b.vy - fvy) * ny;
      if (relVn >= 0) continue; // ball is separating from this circle — skip

      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        hitNx = nx; hitNy = ny;
        hitCx = cx; hitCy = cy;
        hitMinD = minD; hitRelVn = relVn;
      }
    }

    if (bestOverlap <= 0) return;

    // Resolve deepest collision: push ball out and reflect velocity
    b.x = hitCx + hitNx * hitMinD;
    b.y = hitCy + hitNy * hitMinD;
    b.vx -= (1 + FLIP_REST) * hitRelVn * hitNx;
    b.vy -= (1 + FLIP_REST) * hitRelVn * hitNy;
  }

  /* ── DRAIN CHECK ── */
  function checkDrain(b) {
    if (b.y > DRAIN_Y && b.x > DRAIN_LEFT && b.x < DRAIN_RIGHT) {
      drainBall(b);
    }
    // Hard floor
    if (b.y > 1.05) drainBall(b);
  }

  /* ── ANTI-STUCK ── */
  function antiStuck(b, dt) {
    // Balls below the flipper zone are draining — never nudge them back up
    if (b.y > FLIP_Y + 0.02) return;

    const moved = dist(b.x, b.y, b.lastX || b.x, b.lastY || b.y);
    const spd = Math.hypot(b.vx, b.vy);
    b.lastX = b.x; b.lastY = b.y;
    const cornerBoost = (b.x < 0.14 || b.x > 0.86) ? 2 : 1;
    if (spd < 0.04 || moved < 0.0005) b.stuckTime += dt * 1000;
    else b.stuckTime = 0;

    if (b.stuckTime > STUCK_HARD) {
      b.vx += rand(-0.10, 0.10) * cornerBoost;
      b.vy -= (0.18 + Math.random() * 0.06) * cornerBoost;
      b.stuckTime = 0;
      showPop('UNSTUCK!', '#c084fc', b.x, b.y, 1.0);
    } else if (b.stuckTime > STUCK_NUDGE) {
      b.vx += rand(-0.05, 0.05) * cornerBoost;
      b.vy -= 0.10 * cornerBoost;
      b.stuckTime = 0;
      showPop('NUDGE', '#818cf8', b.x, b.y, 0.8);
    }

    // If ball is truly stuck near bottom and barely moving, give a small sideways nudge
    // but do NOT push upward — let gravity handle it naturally.
    if (spd < 0.02 && b.y > 0.7 && !b.staged) {
      b.vx += rand(-0.03, 0.03) * cornerBoost;
      b.vy -= 0.02 * cornerBoost;
    }
  }

  /* ── PLUNGER CONTROLS ── */
  function startCharge() {
    if (!roundRunning || roundSettling) return;
    const staged = activeBalls.find(b => b.alive && b.staged);
    if (!staged) return;
    charging = true;
    chargeStart = performance.now();
  }

  function releaseCharge() {
    if (!charging) return;
    const staged = activeBalls.find(b => b.alive && b.staged);
    if (!staged) { charging = false; return; }
    const power = clamp((performance.now() - chargeStart) / MAX_CHARGE, 0, 1);
    charging = false; chargeVal = 0; chargeStart = 0;
    staged.staged = false;
    // Launch at a random angle across ~170° arc centered on downward
    const speed = LAUNCH_MIN + power * (LAUNCH_MAX - LAUNCH_MIN);
    const launchAngle = rand(-85, 85) * Math.PI / 180;
    staged.vx = Math.sin(launchAngle) * speed;
    staged.vy = Math.cos(launchAngle) * speed;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     DRAWING
     ═══════════════════════════════════════════════════════════════════════════ */
  function draw() {
    if (!ctx2d || !cW) return;
    const c = ctx2d;
    const map = currentMap;
    c.clearRect(0, 0, cW, cH);

    const now = performance.now();
    const tremble = getTrembleOffset(now);

    c.save();
    c.translate(tremble.x, tremble.y);

    drawBg(c, map);
    drawPlayfield(c, map);
    drawPegs(c, map);
    drawBumpers(c, map);
    drawTargets(c, map);
    drawSlingshots(c, map);
    drawFlippers(c, map);
    drawLauncher(c, map);
    drawBalls(c, map);
    if (specialScript) {
      specialScript.draw(c, {
        now,
        map,
        balls: activeBalls,
        toX,
        toY,
        toR,
      });
    }
    drawHUD(c, map);
    c.restore();
  }

  function drawBg(c, map) {
    // Dark gradient background
    const g = c.createLinearGradient(0, 0, cW, cH);
    g.addColorStop(0, hex2rgba(map.accent, 0.06));
    g.addColorStop(0.5, map.baseColor || '#050a14');
    g.addColorStop(1, hex2rgba(map.accent2 || map.accent, 0.04));
    c.fillStyle = g;
    c.fillRect(0, 0, cW, cH);

    // Scanlines
    c.strokeStyle = 'rgba(255,255,255,0.02)';
    c.lineWidth = 1;
    for (let y = 0; y < cH; y += 4) {
      c.beginPath(); c.moveTo(0, y); c.lineTo(cW, y); c.stroke();
    }

    // Center glow
    const rg = c.createRadialGradient(cW * 0.45, cH * 0.3, 10, cW * 0.45, cH * 0.3, cH * 0.6);
    rg.addColorStop(0, hex2rgba(map.accent, 0.10));
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = rg;
    c.fillRect(0, 0, cW, cH);
  }

  function drawPlayfield(c, map) {
    c.save();
    c.shadowColor = map.accent;
    c.shadowBlur = 10;

    const x1 = toX(PF_LEFT), y1 = toY(PF_TOP);
    const x2 = toX(PF_RIGHT);
    const gy = toY(GUTTER_Y);
    const dlx = toX(DRAIN_LEFT), drx = toX(DRAIN_RIGHT);
    const dy = toY(DRAIN_Y);

    // Outer border: top + sides down to gutter start
    c.strokeStyle = hex2rgba(map.accent, 0.25);
    c.lineWidth = 2.5;
    c.beginPath();
    c.moveTo(x1, gy);
    c.lineTo(x1, y1 + 10);
    c.arcTo(x1, y1, x1 + 10, y1, 10);
    c.lineTo(x2 - 10, y1);
    c.arcTo(x2, y1, x2, y1 + 10, 10);
    c.lineTo(x2, gy);
    c.stroke();

    // Two-segment gutter walls through flipper pivots
    const flx = toX(FLIP_LX), frx = toX(FLIP_RX);
    const fy = toY(FLIP_Y);
    c.strokeStyle = hex2rgba(map.accent, 0.30);
    c.shadowBlur = 8;
    c.lineWidth = 3;
    // Left: side wall → flipper pivot → drain
    c.beginPath();
    c.moveTo(x1, gy);
    c.lineTo(flx, fy);
    c.lineTo(dlx, dy);
    c.stroke();
    // Right: side wall → flipper pivot → drain
    c.beginPath();
    c.moveTo(x2, gy);
    c.lineTo(frx, fy);
    c.lineTo(drx, dy);
    c.stroke();

    // Drain gap highlight (red)
    c.strokeStyle = hex2rgba('#ff6b8a', 0.40);
    c.shadowColor = '#ff6b8a';
    c.shadowBlur = 10;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(dlx, dy);
    c.lineTo(drx, dy);
    c.stroke();

    c.restore();
  }

  function drawPegs(c, map) {
    c.save();
    c.shadowColor = map.accent;
    c.shadowBlur = 4;
    for (const p of map.pegs ?? []) {
      const px = toX(p.x), py = toY(p.y);
      const r = toR(p.r ?? 0.008);
      c.fillStyle = hex2rgba(map.accent, 0.55);
      c.beginPath();
      c.arc(px, py, r, 0, Math.PI * 2);
      c.fill();
      // Tiny bright center
      c.fillStyle = 'rgba(255,255,255,0.6)';
      c.beginPath();
      c.arc(px, py, r * 0.4, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  }

  function drawBumpers(c, map) {
    for (const bmp of map.bumpers ?? []) {
      const bx = toX(bmp.x), by = toY(bmp.y);
      const r = toR(bmp.r ?? 0.04);
      c.save();

      // Outer glow
      c.shadowColor = bmp.color || map.accent;
      c.shadowBlur = 24;

      // Fill
      const g = c.createRadialGradient(bx - r * 0.2, by - r * 0.2, r * 0.1, bx, by, r * 1.3);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.3, bmp.color || map.accent);
      g.addColorStop(1, hex2rgba(bmp.color || map.accent, 0.15));
      c.fillStyle = g;
      c.beginPath();
      c.arc(bx, by, r, 0, Math.PI * 2);
      c.fill();

      // Border ring
      c.strokeStyle = hex2rgba(bmp.color || map.accent, 0.6);
      c.lineWidth = 2;
      c.stroke();

      // Emoji label
      if (bmp.emoji) {
        c.font = `${Math.round(r * 1.2)}px serif`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(bmp.emoji, bx, by);
      }

      c.restore();
    }
  }

  function drawTargets(c, map) {
    for (const t of map.targets ?? []) {
      const tx = toX(t.x), ty = toY(t.y);
      const r = toR(t.r ?? 0.028);
      c.save();
      c.shadowColor = t.color || map.accent;
      c.shadowBlur = 14;

      // Circular target with gradient fill
      const g = c.createRadialGradient(tx - r * 0.2, ty - r * 0.2, r * 0.1, tx, ty, r * 1.2);
      g.addColorStop(0, hex2rgba(t.color || map.accent, 0.6));
      g.addColorStop(1, hex2rgba(t.color || map.accent, 0.08));
      c.fillStyle = g;
      c.beginPath();
      c.arc(tx, ty, r, 0, Math.PI * 2);
      c.fill();

      // Ring
      c.strokeStyle = hex2rgba(t.color || map.accent, 0.5);
      c.lineWidth = 1.5;
      c.stroke();

      // Label
      c.fillStyle = '#fff';
      c.font = `600 ${Math.max(8, Math.round(r * 0.7))}px system-ui, sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(t.emoji || t.label?.[0] || '★', tx, ty);
      c.restore();
    }
  }

  function drawSlingshots(c, map) {
    for (const s of map.slingshots ?? []) {
      const sx = toX(s.x), sy = toY(s.y);
      const r = toR(s.r ?? 0.04);
      c.save();
      c.shadowColor = s.color || map.accent;
      c.shadowBlur = 16;

      // Triangular/diamond slingshot shape
      const g = c.createRadialGradient(sx, sy, r * 0.2, sx, sy, r * 1.4);
      g.addColorStop(0, hex2rgba(s.color || map.accent, 0.4));
      g.addColorStop(1, hex2rgba(s.color || map.accent, 0.05));
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(sx, sy - r * 1.2);
      c.lineTo(sx + r, sy);
      c.lineTo(sx, sy + r * 1.2);
      c.lineTo(sx - r, sy);
      c.closePath();
      c.fill();

      c.strokeStyle = hex2rgba(s.color || map.accent, 0.5);
      c.lineWidth = 1.5;
      c.stroke();

      if (s.emoji) {
        c.font = `${Math.round(r * 1.1)}px serif`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(s.emoji, sx, sy);
      }

      c.restore();
    }
  }

  function drawFlippers(c, map) {
    drawOneFlipper(c, 'left', flipLAngle, map.accent);
    drawOneFlipper(c, 'right', flipRAngle, map.accent2 || map.accent);
  }

  function drawOneFlipper(c, side, angle, color) {
    const px = toX(side === 'left' ? FLIP_LX : FLIP_RX);
    const py = toY(FLIP_Y);
    const dir = side === 'left' ? 1 : -1;
    const tipPx = px + Math.cos(angle) * toR(FLIP_LEN) * dir;
    const tipPy = py - Math.sin(angle) * toR(FLIP_LEN);
    const thick = toR(FLIP_THICK);

    c.save();
    c.lineCap = 'round';
    c.lineWidth = thick * 2;
    c.strokeStyle = color;
    c.shadowColor = color;
    c.shadowBlur = 18;
    c.beginPath();
    c.moveTo(px, py);
    c.lineTo(tipPx, tipPy);
    c.stroke();

    // Pivot dot
    c.fillStyle = color;
    c.beginPath();
    c.arc(px, py, thick * 1.2, 0, Math.PI * 2);
    c.fill();

    // Tip dot (smaller)
    c.fillStyle = '#fff';
    c.beginPath();
    c.arc(tipPx, tipPy, thick * 0.6, 0, Math.PI * 2);
    c.fill();

    c.restore();
  }

  function drawLauncher(c, map) {
    const staged = activeBalls.some(b => b.alive && b.staged);
    if (!staged && !charging) return;
    const sx = toX(SPAWN_X), sy = toY(SPAWN_Y);
    const stagedBall = activeBalls.find(b => b.alive && b.staged);
    const r = toR(ballRadius(stagedBall ?? { radiusScale: 1 }));
    const chg = charging ? clamp((performance.now() - chargeStart) / MAX_CHARGE, 0, 1) : 0;
    const pulse = 0.8 + Math.sin(performance.now() * 0.006) * 0.2;

    c.save();

    // Expanding glow ring when charging
    if (chg > 0) {
      const glowR = r * (2 + chg * 5);
      const rg = c.createRadialGradient(sx, sy, r, sx, sy, glowR);
      rg.addColorStop(0, hex2rgba(map.accent2 || map.accent, 0.25 + chg * 0.3));
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = rg;
      c.beginPath();
      c.arc(sx, sy, glowR, 0, Math.PI * 2);
      c.fill();
    }

    // Charge ring
    c.strokeStyle = hex2rgba(map.accent, 0.3 + chg * 0.5);
    c.lineWidth = 2;
    c.shadowColor = map.accent;
    c.shadowBlur = chg > 0 ? 18 + chg * 14 : 8 * pulse;
    c.beginPath();
    c.arc(sx, sy, r + 4 + chg * 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (chg || pulse * 0.3));
    c.stroke();

    // Charge percent label
    c.fillStyle = 'rgba(255,255,255,0.6)';
    c.font = '700 9px system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(charging ? `${Math.round(chg * 100)}%` : 'HOLD', sx, sy - r - 14);

    c.restore();
  }

  function drawBalls(c, map) {
    const now = performance.now();
    for (const b of activeBalls) {
      if (!b.alive) continue;
      const bx = toX(b.x), by = toY(b.y);
      const r = toR(ballRadius(b));

      c.save();
      // Trail
      if (!b.staged && b.trail.length > 2) {
        for (let i = 0; i < b.trail.length - 1; i++) {
          const t = b.trail[i];
          const alpha = 0.05 + (i / b.trail.length) * 0.15;
          c.fillStyle = hex2rgba(b.glowColor || map.accent2 || map.accent, alpha);
          c.beginPath();
          c.arc(toX(t.x), toY(t.y), r * (0.4 + i / b.trail.length * 0.4), 0, Math.PI * 2);
          c.fill();
        }
      }

      // Ball glow
      c.shadowColor = b.glowColor || map.accent;
      c.shadowBlur = b.staged ? 30 : (b.speedBoostUntil > now ? 30 : 20);

      // Ball body
      const g = c.createRadialGradient(bx - r * 0.3, by - r * 0.3, r * 0.1, bx, by, r);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.4, hex2rgba(b.glowColor || map.accent2 || map.accent, 0.95));
      g.addColorStop(1, hex2rgba(b.glowColor || map.accent, 0.3));
      c.fillStyle = g;
      c.beginPath();
      c.arc(bx, by, r, 0, Math.PI * 2);
      c.fill();

      if (b.speedBoostUntil > now) {
        c.strokeStyle = hex2rgba(b.glowColor || map.accent2 || map.accent, 0.75);
        c.lineWidth = 2;
        c.beginPath();
        c.arc(bx, by, r * 1.25, 0, Math.PI * 2);
        c.stroke();
      }

      if (b.radiusScale > 1.05) {
        c.strokeStyle = hex2rgba('#ffffff', 0.5);
        c.lineWidth = 2;
        c.beginPath();
        c.arc(bx, by, r * 1.15, 0, Math.PI * 2);
        c.stroke();
      }

      // Specular highlight
      c.fillStyle = 'rgba(255,255,255,0.5)';
      c.beginPath();
      c.arc(bx - r * 0.25, by - r * 0.25, r * 0.3, 0, Math.PI * 2);
      c.fill();

      c.restore();
    }
  }

  function drawHUD(c, map) {
    c.save();
    // Score
    c.font = '800 15px system-ui, sans-serif';
    c.textAlign = 'left';
    c.fillStyle = '#fff';
    const estCredits = Math.ceil(Math.round(score) / 100);
    c.fillText(`SCORE ${Math.round(score).toLocaleString()}  ≈ ${estCredits} cr`, pfX + 8, pfY + 18);

    c.font = '700 12px system-ui, sans-serif';
    c.fillStyle = map.accent;
    c.fillText(`COMBO ${combo}x`, pfX + 8, pfY + 34);

    // Balls remaining
    c.textAlign = 'right';
    c.fillStyle = '#d0f0ff';
    c.font = '800 15px system-ui, sans-serif';
    const remaining = ballsLeft + activeBalls.filter(b => b.alive).length;
    c.fillText(`BALLS ${remaining}`, pfX + pfW - 8, pfY + 18);

    // Map name + emoji
    c.fillStyle = hex2rgba(map.accent2 || map.accent, 0.7);
    c.font = '600 11px system-ui, sans-serif';
    c.fillText(`${map.emoji || ''} ${map.name}`, pfX + pfW - 8, pfY + 34);

    // Controls hint at bottom
    c.fillStyle = 'rgba(255,255,255,0.35)';
    c.font = '500 9px system-ui, sans-serif';
    c.textAlign = 'center';
    const hint = isMobile
      ? 'HOLD center = launch · TAP left/right = flippers'
      : 'SPACE = launch · ← → = flippers';
    c.fillText(hint, pfX + pfW / 2, toY(PF_BOT) - 6);
    c.restore();
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     GAME LOOP
     ═══════════════════════════════════════════════════════════════════════════ */
  function ensureLoop() {
    if (rafId != null) return;
    const tick = (ts) => {
      if (!roundRunning && !roundSettling && !charging) {
        rafId = null;
        draw();
        return;
      }
      if (!lastTs) lastTs = ts;
      const dt = Math.min(0.025, (ts - lastTs) / 1000);
      lastTs = ts;
      step(dt);
      draw();
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     INPUT HANDLING
     ═══════════════════════════════════════════════════════════════════════════ */
  function setupInput() {
    const onKeyDown = (e) => {
      if (e.repeat) return;
      const tag = (e.target?.tagName ?? '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
      if (typing) return;

      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        if (mode === 'playing') startCharge();
      }
      if (e.code === 'ArrowLeft' || e.code === 'KeyZ') {
        e.preventDefault(); leftHeld = true;
      }
      if (e.code === 'ArrowRight' || e.code === 'KeyX') {
        e.preventDefault(); rightHeld = true;
      }
    };

    const onKeyUp = (e) => {
      const tag = (e.target?.tagName ?? '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
      if (e.code === 'Space' || e.key === ' ') {
        if (!typing) e.preventDefault();
        if (charging) releaseCharge();
      }
      if (e.code === 'ArrowLeft' || e.code === 'KeyZ') {
        e.preventDefault(); leftHeld = false;
      }
      if (e.code === 'ArrowRight' || e.code === 'KeyX') {
        e.preventDefault(); rightHeld = false;
      }
    };

    // Mobile touch
    let plungerTouch = null;
    const onTouchStart = (e) => {
      if (mode !== 'playing') return;
      for (const touch of e.changedTouches) {
        const rect = canvas.getBoundingClientRect();
        const rx = (touch.clientX - rect.left) / rect.width;
        const ry = (touch.clientY - rect.top) / rect.height;

        // Center area = plunger
        if (rx > 0.3 && rx < 0.7 && ry > 0.4) {
          e.preventDefault();
          plungerTouch = touch.identifier;
          startCharge();
          continue;
        }
        // Left side = left flipper
        if (rx < 0.4) {
          e.preventDefault();
          leftHeld = true;
        }
        // Right side = right flipper
        if (rx > 0.6) {
          e.preventDefault();
          rightHeld = true;
        }
      }
    };

    const onTouchEnd = (e) => {
      for (const touch of e.changedTouches) {
        if (touch.identifier === plungerTouch) {
          plungerTouch = null;
          if (charging) releaseCharge();
        }
        const rect = canvas.getBoundingClientRect();
        const rx = (touch.clientX - rect.left) / rect.width;
        if (rx < 0.4) leftHeld = false;
        if (rx > 0.6) rightHeld = false;
      }
    };

    window.addEventListener('keydown', onKeyDown, { passive: false });
    window.addEventListener('keyup', onKeyUp, { passive: false });
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', onTouchEnd, { passive: false });

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchend', onTouchEnd);
      canvas.removeEventListener('touchcancel', onTouchEnd);
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     VIEW BUILDERS
     ═══════════════════════════════════════════════════════════════════════════ */
  function redraw() { mount(root, view()); }

  function statCard(label, value, color) {
    return h('div.rounded-2xl.border.border-white/10.bg-white/[0.03].px-4.py-3', {}, [
      h('div.text-[10px].uppercase.tracking-widest.text-muted', {}, [label]),
      h('div.mt-1.font-mono.text-lg.font-semibold', { style: { color } }, [value]),
    ]);
  }

  function view() {
    const profile = userStore.get().profile;
    const credits = profile?.credits ?? 0;

    // ── RESULT SCREEN ──
    if (mode === 'result' && roundOutcome) {
      const o = roundOutcome;
      return h('div.flex.flex-col.gap-5', {}, [
        h('div.rounded-2xl.border.border-white/10.bg-white/[0.03].p-5', {}, [
          h('div.text-[10px].uppercase.tracking-[0.38em].text-muted', {}, ['Round Complete']),
          h('h2.mt-2.text-3xl.font-black.tracking-tight.text-white', {}, [
            o.won ? `${currentMap.emoji} You won!` : `${currentMap.emoji} You lost.`,
          ]),
          h('p.mt-2.text-sm.text-muted', {}, [
            `${currentMap.name} — ${o.score.toLocaleString()} pts → ${formatCredits(o.payout)} cr`,
            o.won
              ? ` · net +${formatCredits(o.payout - o.stake)} cr`
              : ` · net −${formatCredits(o.stake - o.payout)} cr`,
          ]),
        ]),
        h('div.grid.gap-3.grid-cols-2.lg:grid-cols-4', {}, [
          statCard('Score', Math.round(o.score).toLocaleString(), currentMap.accent),
          statCard('Payout', formatCredits(o.payout), currentMap.accent2 || currentMap.accent),
          statCard('Net', formatCredits(o.payout - o.stake), o.won ? '#4ade80' : '#ff6b8a'),
          statCard('Balance', formatCredits(o.newBalance), '#d0f0ff'),
        ]),
        h('div.grid.gap-3.grid-cols-3', {}, [
          statCard('Max Combo', `${o.comboMax}x`, currentMap.accent),
          statCard('Bumper Hits', String(o.bumperHits), currentMap.accent2 || currentMap.accent),
          statCard('Drains', String(o.drainCount), '#ff6b8a'),
        ]),
        h('div.flex.flex-wrap.gap-3', {}, [
          h('button.btn-primary.h-12.min-w-[180px].px-6.text-sm.font-semibold', {
            onclick: () => { mode = 'pregame'; round = null; roundOutcome = null; redraw(); },
            style: { background: `linear-gradient(135deg, ${currentMap.accent}, ${currentMap.accent2 || currentMap.accent})` },
          }, ['Play Again']),
          h('button.btn-ghost.h-12.min-w-[160px].px-6.text-sm.font-semibold', {
            onclick: () => { mode = 'pregame'; round = null; roundOutcome = null; redraw(); },
          }, ['Back to Buy-in']),
        ]),
      ]);
    }

    // ── PLAYING SCREEN ──
    if (mode === 'playing') {
      return h('div.flex.flex-col.items-center.gap-3', {}, [
        cabinet,
        isMobile ? h('div.grid.grid-cols-3.gap-3.w-full.max-w-[420px]', {}, [
          h('button.btn-primary.h-16.text-lg.font-bold.rounded-2xl', {
            onpointerdown: (e) => { e.preventDefault(); leftHeld = true; },
            onpointerup: () => { leftHeld = false; },
            onpointercancel: () => { leftHeld = false; },
            onpointerleave: () => { leftHeld = false; },
            style: { background: currentMap.accent },
          }, ['◀ LEFT']),
          h('button.btn-primary.h-16.text-lg.font-bold.rounded-2xl', {
            onpointerdown: (e) => { e.preventDefault(); startCharge(); },
            onpointerup: () => { if (charging) releaseCharge(); },
            onpointercancel: () => { if (charging) releaseCharge(); },
            onpointerleave: () => { if (charging) releaseCharge(); },
            style: { background: `linear-gradient(135deg, ${currentMap.accent}, ${currentMap.accent2 || currentMap.accent})` },
          }, ['🎯 LAUNCH']),
          h('button.btn-primary.h-16.text-lg.font-bold.rounded-2xl', {
            onpointerdown: (e) => { e.preventDefault(); rightHeld = true; },
            onpointerup: () => { rightHeld = false; },
            onpointercancel: () => { rightHeld = false; },
            onpointerleave: () => { rightHeld = false; },
            style: { background: currentMap.accent2 || currentMap.accent },
          }, ['RIGHT ▶']),
        ]) : null,
      ]);
    }

    // ── PREGAME SCREEN ──
    const ballBtns = PINBALL_BALL_OPTIONS.map(n =>
      h('button.btn-ghost.h-10.flex-1.text-xs.font-semibold', {
        onclick: () => { ballChoice = n; redraw(); },
        style: ballChoice === n ? {
          borderColor: '#22e1ff',
          color: '#22e1ff',
          boxShadow: '0 0 12px rgba(34,225,255,0.3)',
        } : {},
      }, [`${n} ball${n > 1 ? 's' : ''}`])
    );

    return h('div.flex.flex-col.gap-5', {}, [
      h('div.rounded-2xl.border.border-white/10.bg-white/[0.03].p-5', {}, [
        h('div.text-[10px].uppercase.tracking-[0.38em].text-muted', {}, ['Neon Pinball']),
        h('h2.mt-2.text-3xl.font-black.tracking-tight.text-white', {}, ['Choose your buy-in.']),
        h('p.mt-2.text-sm.leading-6.text-muted', {}, [
          'Pick your bet and ball count. The server picks a random map when the round starts. ',
          'Charge the plunger, hit bumpers, rack up combos, and try to beat the house.',
        ]),
      ]),
      h('div.rounded-2xl.border.border-white/10.bg-white/[0.03].p-5', {}, [
        h('div.flex.flex-wrap.items-center.gap-4', {}, [
          h('div.flex.flex-col.gap-1.min-w-[180px]', {}, [
            h('span.text-[10px].uppercase.tracking-widest.text-muted', {}, ['Buy-in']),
            bet.el,
          ]),
          h('div.flex.gap-2', {}, ballBtns),
          h('button.btn-primary.h-12.min-w-[200px].px-6.text-sm.font-semibold', {
            onclick: launchRound,
            disabled: roundRunning || roundSettling || launchBusy,
            style: {
              background: 'linear-gradient(135deg, #22e1ff 0%, #ff2bd6 100%)',
            },
          }, [
            launchBusy ? 'Starting…' : `Start Round · ${formatCredits((bet.get() || 0) * ballChoice)} cr`,
          ]),
          h('span.font-mono.text-xs.uppercase.tracking-widest.text-muted', {}, [
            `${formatCredits(credits)} cr`,
          ]),
        ]),
        h('p.mt-3.text-xs.text-muted', {}, [
          'The map is random. 5 themed tables: 🌲 Forest · 🌌 Galaxy · 🌊 Deep Sea · 🌋 Volcano · 🤖 Cyber',
        ]),
      ]),
      // Map showcase grid
      h('div.grid.gap-3.sm:grid-cols-2.lg:grid-cols-3', {}, PINBALL_MAPS.map(m =>
        h('div.rounded-2xl.border.border-white/10.bg-white/[0.03].p-4', {}, [
          h('div.flex.items-center.gap-3', {}, [
            h('span.text-2xl', {}, [m.emoji || '🎯']),
            h('div', {}, [
              h('div.font-mono.text-sm.font-semibold', { style: { color: m.accent } }, [m.name]),
              h('p.mt-1.text-xs.text-muted.leading-5', {}, [m.description || '']),
            ]),
          ]),
        ])
      )),
      h('div.rounded-2xl.border.border-white/10.bg-white/[0.03].p-4.text-xs.text-muted', {}, [
        h('span.font-semibold.text-white', {}, ['Controls: ']),
        isMobile
          ? 'Hold center to charge plunger, release to launch. Tap left/right side for flippers.'
          : 'SPACE = hold to charge, release to launch. Arrow keys or Z/X = flippers.',
      ]),
    ]);
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     LIFECYCLE
     ═══════════════════════════════════════════════════════════════════════════ */
  const cleanupInput = setupInput();

  resizeObs = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(() => { resize(); draw(); })
    : null;
  resizeObs?.observe(cabinet);

  function lockScroll() { document.body.style.overflow = 'hidden'; }
  function unlockScroll() { document.body.style.overflow = ''; }

  ctx?.onCleanup?.(() => {
    cleanupInput();
    resizeObs?.disconnect();
    for (const t of popTimers) clearTimeout(t);
    popTimers.clear();
    if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
    unlockScroll();
  });

  redraw();
  setTimeout(() => { resize(); draw(); }, 0);

  return appShell(root, { wide: true });
}
