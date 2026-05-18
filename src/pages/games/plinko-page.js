/**
 * plinko-page.js
 *
 * Stake-style peg board with multi-ball support and proper continuous
 * physics. The user picks rows (8/10/12), risk (low/medium/high), a per-ball
 * bet and a ball count (1, 5, 10, 25, 50). * The server reserves the wager for each batch, then the client animates the
 * balls with actual peg-to-peg bounce physics. When every ball has landed,
 * the batch settles using the bins they actually reached.
 */
import { h, mount } from '../../utils/dom.js';
import { appShell } from '../../ui/layout/app-shell.js';
import { createBetInput } from '../../ui/components/bet-input.js';
import {
  playPlinkoBatch,
  settlePlinkoBatch,
  PLINKO_ROWS,
  PLINKO_RISKS,
  PLINKO_BATCH_SIZES,
  getPlinkoMults,
  getPlinkoColors,
} from '../../games/plinko/plinko-api.js';
import { userStore, patchProfile } from '../../state/user-store.js';
import { toastError } from '../../ui/components/toast.js';
import { validateBet } from '../../utils/validation.js';
import { formatCredits, formatMultiplier } from '../../utils/format.js';
import { GAMES } from '../../config/constants.js';
import {
  flashSuccessMajor,
  flashGold,
  flashLossMajor,
} from '../../ui/fx/feedback-fx.js';

// ---------------------------------------------------------------------------
// Tuning knobs
// ---------------------------------------------------------------------------
const BALL_RADIUS    = 5.4;
const PEG_RADIUS     = 3.8;
const HIT_RADIUS     = BALL_RADIUS + PEG_RADIUS + 0.6;
const GRAVITY        = 1700;   // px / s^2
const RESTITUTION    = 0.55;   // peg bounce energy retained
const FRICTION_PER_S = 0.92;   // air drag (per-second multiplier)
const BALL_STAGGER   = 130;    // ms between sequential ball drops
const TRAIL_LEN      = 8;

export function renderPlinko() {
  let rows = 8;
  let risk = 'medium';
  let count = 1;
  let busy = false;
  let history = [];
  let nextBatchId = 1;
  const pendingBatches = new Map();

  const bet = createBetInput({ value: 25, min: GAMES.PLINKO?.minBet ?? 1 });

  // Internal backing-store resolution: fixed at 3× the CSS box so pegs /
  // bins / ball edges stay crisp on every display, regardless of the
  // window.devicePixelRatio the browser reports. 2× was noticeably soft
  // on standard-DPI monitors; 3× is indistinguishable from native.
  const RENDER_SCALE = 3;
  const canvas = h('canvas.w-full.rounded-xl.border.border-white/10', {
    style: {
      display: 'block',
      maxHeight: '460px',
      background:
        'radial-gradient(ellipse at top,#1a1336 0%,#0d0a1a 55%,#06060e 100%)',
    },
  });

  // Live state shared by the rAF loop.
  const sim = {
    balls: [],          // active ball objects
    pulses: [],         // peg impact pulses
    binFlashes: [],     // bin landing pulses (binIdx -> until ts)
    raf: null,
    ctx: null,
    cssW: 0,
    cssH: 0,
  };

  function setCanvasSize() {
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(320, rect.width || 640);
    const cssH = Math.max(280, Math.min(460, Math.round(cssW * 0.74)));
    canvas.width  = Math.round(cssW * RENDER_SCALE);
    canvas.height = Math.round(cssH * RENDER_SCALE);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    sim.ctx = ctx;
    sim.cssW = cssW;
    sim.cssH = cssH;
    return { ctx, cssW, cssH };
  }

  // ------------------- UI controls -------------------
  const resultEl   = h('div.hidden', {}, ['']);
  const historyEl  = h('div.flex.gap-1.flex-wrap.justify-center.min-h-[28px]', {}, []);

  const rowBtns = PLINKO_ROWS.map((r) =>
    h('button.btn.flex-1.h-10', { onclick: () => { rows = r; refresh(); } }, [`${r} rows`])
  );
  const riskBtns = PLINKO_RISKS.map((r) =>
    h('button.btn.flex-1.h-10.capitalize', { onclick: () => { risk = r; refresh(); } }, [r])
  );
  const countBtns = PLINKO_BATCH_SIZES.map((c) =>
    h('button.btn.flex-1.h-10', { onclick: () => { count = c; refresh(); } }, [`${c}\u00d7`])
  );

  function anyInFlight() {
    return sim.balls.some((b) => b.live);
  }

  function refresh() {
    setCanvasSize();
    drawBoard(sim.ctx, sim.cssW, sim.cssH, rows, risk, sim.binFlashes);
    // Row/risk/count selectors change the board geometry, so they are
    // locked while any ball is still in motion. The drop button itself
    // stays enabled so the player can queue more balls on the fly.
    const locked = busy || anyInFlight();
    rowBtns.forEach((b, i) => {
      b.className = `btn h-10 flex-1 ${PLINKO_ROWS[i] === rows ? 'btn-primary' : 'btn-ghost'}`;
      b.disabled = locked;
    });
    riskBtns.forEach((b, i) => {
      b.className = `btn h-10 flex-1 capitalize ${PLINKO_RISKS[i] === risk ? 'btn-primary' : 'btn-ghost'}`;
      b.disabled = locked;
    });
    countBtns.forEach((b, i) => {
      b.className = `btn h-10 flex-1 ${PLINKO_BATCH_SIZES[i] === count ? 'btn-primary' : 'btn-ghost'}`;
      b.disabled = locked;
    });
    dropBtn.disabled = busy;
  }

  async function finalizeBatch(batch) {
    if (!batch || batch.revealed || batch.settling) return;
    batch.settling = true;

    try {
      const settled = await settlePlinkoBatch(batch.batchId, batch.landedBins);
      const results = Array.isArray(settled) && settled.length > 0 ? settled : batch.localResults;
      const finalBalance = results[results.length - 1]?.newBalance;

      const totalPay = results.reduce((s, r) => s + r.payout, 0);
      const profit   = totalPay - batch.total;

      const bestMult = results.reduce((m, r) => Math.max(m, r.multiplier), 0);
      if (profit > 0) {
        if (bestMult >= 20) flashGold({ label: `${formatMultiplier(bestMult)}×` });
        else flashSuccessMajor({ label: `WIN · +${formatCredits(profit)}` });
      } else if (profit < 0) {
        flashLossMajor({ label: 'BUST', intense: true });
      }

      history = [
        ...results.slice().reverse().map((r) => ({ mult: r.multiplier, won: r.won })),
        ...history,
      ].slice(0, 32);
      renderHistory();

      resultEl.textContent = '';
      resultEl.className = 'hidden';

      await new Promise((resolve) => setTimeout(resolve, profit > 0 ? (bestMult >= 20 ? 1450 : 1150) : 900));

      if (typeof finalBalance === 'number') patchProfile({ credits: finalBalance });

      batch.revealed = true;
      pendingBatches.delete(batch.id);
    } catch (e) {
      toastError(e.message ?? String(e));
      batch.settling = false;
      return;
    } finally {
      busy = false;
      refresh();
    }
  }

  function renderHistory() {
    mount(
      historyEl,
      h('div.flex.gap-1.flex-wrap.justify-center', {},
        history.slice(0, 24).map((it) =>
          h('span.inline-flex.items-center.justify-center.rounded-md.px-2.py-1.text-[11px].font-mono', {
            style: {
              background: it.won ? 'rgba(0,255,170,0.12)' : 'rgba(255,0,80,0.12)',
              border: `1px solid ${it.won ? 'rgba(0,255,170,0.35)' : 'rgba(255,0,80,0.35)'}`,
              color: it.won ? '#00ffaa' : '#ff6d8a',
            },
          }, [formatMultiplier(it.mult)])
        )
      )
    );
  }

  // ------------------- Drop handler -------------------
  // `busy` guards ONLY the RPC round-trip (to prevent a double-submit
  // from the same click). Once the RPC returns, balls are queued and the
  // button is immediately re-armed so the player can stack more drops
  // while previous balls are still falling — this is the "multi-drop"
  // UX: every click sends one batch, the physics layer handles the pile-up.
  const dropBtn = h('button.btn-primary.h-12.w-full.text-base', {
    onclick: async () => {
      if (busy) return;
      const amount = bet.get();
      const total = amount * count;
      const balErr = validateBet(total, userStore.get().profile?.credits);
      if (balErr) return toastError(balErr);

      busy = true;
      refresh();

      let start;
      try {
        start = await playPlinkoBatch(amount, rows, risk, count);
      } catch (e) {
        toastError(e.message ?? String(e));
        busy = false;
        refresh();
        return;
      }

      const batchId = start?.batchId ?? nextBatchId++;
      // paths: boolean[][] from server — one L/R sequence per ball.
      // null if server didn't provide them (fallback to random).
      const serverPaths = Array.isArray(start?.paths) ? start.paths : null;
      const batch = {
        id: batchId,
        batchId,
        amount,
        total,
        rows,
        risk,
        remaining: count,
        revealed: false,
        settling: false,
        landedBins: [],
        localResults: [],
      };
      pendingBatches.set(batch.id, batch);
      resultEl.textContent = '';
      resultEl.className = 'hidden';

      if (typeof start?.newBalance === 'number') patchProfile({ credits: start.newBalance });

      // Spawn balls staggered. Each ball follows the server-provided L/R path
      // so the animation outcome matches the server's predetermined result exactly.
      const startedAt = performance.now();
      for (let i = 0; i < count; i++) {
        const ballPath = serverPaths ? serverPaths[i] : null;
        spawnBall({ batchId: batch.id, amount, rows, risk }, startedAt + i * BALL_STAGGER, batch.id, ballPath);
      }
      busy = false;
      ensureRafRunning();
      refresh();

    },
  }, ['Drop balls']);

  // Resize observer keeps the board correct when the panel reflows.
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => refresh()) : null;
  if (ro) ro.observe(canvas);

  // Initial paint after the canvas is in the DOM.
  setTimeout(refresh, 0);

  // ------------------- Sim helpers -------------------
  function spawnBall(result, atTime, batchId, serverPath = null) {
    const { pegs, padX, padTop } = getPegs(sim.cssW, sim.cssH, rows);
    const top = pegs.find((p) => p.row === 0) ?? { x: sim.cssW / 2 };
    sim.balls.push({
      x: top.x + (Math.random() - 0.5) * 4,
      y: padTop - 18,
      vx: 0,
      vy: 0,
      pegRow: 0,
      bet: result.amount,
      rows: result.rows,
      risk: result.risk,
      hue: '#7be1ff',
      serverPath,   // boolean[] from server, or null (fallback to Math.random)
      trail: [],
      bornAt: atTime,
      live: true,
      settled: false,
      lastPegHitAt: -Infinity,
      _ignorePadX: padX,
      batchId,
    });
  }

  function ensureRafRunning() {
    if (sim.raf) return;
    let last = performance.now();
    const step = (now) => {
      const dt = Math.min(0.045, (now - last) / 1000);
      last = now;
      tickSim(dt, now);
      drawFrame();
      const stillBusy = sim.balls.some((b) => b.live) ||
                        sim.pulses.length > 0 ||
                        sim.binFlashes.some((bf) => bf.until > now);
      if (stillBusy) {
        sim.raf = requestAnimationFrame(step);
      } else {
        sim.raf = null;
        // Clear settled balls so the board redraws cleanly.
        sim.balls = sim.balls.filter((b) => b.live);
        drawBoard(sim.ctx, sim.cssW, sim.cssH, rows, risk, sim.binFlashes);
        // All balls are down — finalize any batches that have completed.
        for (const batch of pendingBatches.values()) {
          if (!batch.revealed && batch.remaining <= 0) {
            finalizeBatch(batch);
          }
        }
      }
    };
    sim.raf = requestAnimationFrame(step);
  }

  function tickSim(dt, now) {
    const { pegs, padX, padBot, binY, pegGapY, pegGapX } = getPegs(sim.cssW, sim.cssH, rows);
    const binW = (sim.cssW - padX * 2) / (rows + 1);

    for (const b of sim.balls) {
      if (!b.live) continue;
      if (now < b.bornAt) continue; // staggered start
      if (!isFinitePoint(b.x, b.y)) {
        b.live = false;
        continue;
      }

      // Integrate
      b.vy += GRAVITY * dt;
      b.vx *= Math.pow(FRICTION_PER_S, dt);
      b.x  += b.vx * dt;
      b.y  += b.vy * dt;

      // Trail
      if (b.trail.length === 0 || b.trail[b.trail.length - 1].t < now - 16) {
        b.trail.push({ x: b.x, y: b.y, t: now });
        if (b.trail.length > TRAIL_LEN) b.trail.shift();
      }

      // Peg deflection: move down peg row-by-row with a real bounce off
      // the nearest peg in the current row.
      if (b.pegRow < rows) {
        const targetRow = b.pegRow;
        const peg = closestPegInRow(pegs, targetRow, b.x);
        if (peg) {
          const dx = b.x - peg.x;
          const dy = b.y - peg.y;
          const d  = Math.hypot(dx, dy) || 1;
          const rowTriggerY = peg.y - pegGapY * 0.18;
          const rowWindowX = Math.max(HIT_RADIUS * 3.0, pegGapX * 0.88);
          // Bounce once per peg level when the ball reaches that row's band.
          if (b.y >= rowTriggerY && Math.abs(dx) <= rowWindowX) {
            // Resolve overlap so the ball never tunnels through.
            const nx = dx / (d || 1);
            const ny = dy / (d || 1);
            b.x = peg.x + nx * HIT_RADIUS * 0.9;
            b.y = peg.y + Math.max(4, pegGapY * 0.08);

            // Reflect velocity around the peg-normal with restitution.
            const vDotN = b.vx * nx + b.vy * ny;
            b.vx -= (1 + RESTITUTION) * vDotN * nx;
            b.vy -= (1 + RESTITUTION) * vDotN * ny;

            // Turn the reflection into a visible plinko bounce.
            // Use the server-provided L/R decision for this row when available,
            // so the animation exactly follows the server's predetermined outcome.
            const wentRight = b.serverPath
              ? (b.serverPath[b.pegRow] === true)
              : Math.random() < 0.5;
            const side = wentRight ? 1 : -1;
            const speed = Math.max(130, Math.hypot(b.vx, b.vy));
            const lateralKick = Math.max(120, pegGapX * 1.18 + speed * 0.12);
            const downwardKick = Math.max(72, Math.min(150, speed * 0.18 + 14));
            b.vx = (b.vx * 0.10) + side * lateralKick;
            b.vx = Math.max(-220, Math.min(220, b.vx));
            b.vy = downwardKick;
            b.x = peg.x + side * Math.max(10, pegGapX * 0.18);

            sim.pulses.push({
              x: peg.x, y: peg.y,
              color: b.hue,
              r: PEG_RADIUS + 1,
              opacity: 0.85,
            });
            b.pegRow += 1;
            b.lastPegHitAt = now;
          }
        }
      }

      // Lateral wall clamp (in case a steer takes the ball outside the
      // board area — visually only, doesn't affect server result).
      if (b.x < padX + 4)            { b.x = padX + 4;            b.vx = Math.abs(b.vx) * 0.4; }
      if (b.x > sim.cssW - padX - 4) { b.x = sim.cssW - padX - 4; b.vx = -Math.abs(b.vx) * 0.4; }

      // Settle when below the bin row.
      if (b.y >= binY || b.y >= sim.cssH - BALL_RADIUS - 2 || b.y > sim.cssH + 24) {
        // Determine the landed bin: if server provided a path, count the
        // "went right" steps — that equals the bin index by definition.
        // Otherwise fall back to position-based calculation.
        const landedBin = b.serverPath
          ? Math.max(0, Math.min(rows, b.serverPath.filter(Boolean).length))
          : Math.max(0, Math.min(rows, Math.floor((b.x - padX) / binW)));
        const targetX = padX + landedBin * binW + binW / 2;
        const multiplier = getPlinkoMults(rows, risk)[landedBin];
        const payout = Math.floor(b.bet * multiplier);
        b.x = targetX;
        b.y = binY + 6;
        b.vx = 0;
        b.vy = 0;
        b.live = false;
        b.settled = true;
        sim.binFlashes[landedBin] = { until: now + 700, color: b.hue, mult: multiplier };
        const batch = pendingBatches.get(b.batchId);
        if (batch && !batch.revealed) {
          batch.landedBins.push(landedBin);
          batch.localResults.push({ binIndex: landedBin, multiplier, payout, won: payout > b.bet });
          batch.remaining -= 1;
          if (batch.remaining <= 0) finalizeBatch(batch);
        }
      }
    }

    // Decay pulses
    for (const p of sim.pulses) {
      p.r += 36 * dt;
      p.opacity -= 2.4 * dt;
    }
    sim.pulses = sim.pulses.filter((p) => p.opacity > 0);
  }

  function drawFrame() {
    drawBoard(sim.ctx, sim.cssW, sim.cssH, rows, risk, sim.binFlashes);
    for (const p of sim.pulses) drawPulse(sim.ctx, p);
    for (const b of sim.balls) {
      if (performance.now() < b.bornAt) continue;
      if (!isFinitePoint(b.x, b.y)) {
        b.live = false;
        continue;
      }
      drawTrail(sim.ctx, b);
      drawBall(sim.ctx, b.x, b.y, b.hue);
    }
  }

  // ------------------- View tree -------------------
  return appShell(
    h('div.flex.flex-col.gap-4', {}, [
      h('h1.text-3xl.font-semibold.heading-grad', {}, ['Plinko']),
      h('p.text-sm.text-muted', {}, [
        'Drop balls through the pegs. They bounce left and right and land in a multiplier slot. Riskier boards have bigger edges \u2014 and emptier centres.',
      ]),
      h('div.grid.grid-cols-1.lg:grid-cols-3.gap-4', {}, [
        h('div.lg:col-span-2.glass.neon-border.p-4.flex.flex-col.gap-3', {}, [
          canvas,
          resultEl,
          h('div.text-[10px].text-muted.uppercase.tracking-widest.mt-1', {}, ['Last drops']),
          historyEl,
        ]),
        h('div.glass.neon-border.p-6.flex.flex-col.gap-4', {}, [
          h('div.flex.flex-col.gap-2', {}, [
            h('label.text-xs.text-muted.uppercase.tracking-widest', {}, ['Rows']),
            h('div.flex.gap-2', {}, rowBtns),
          ]),
          h('div.flex.flex-col.gap-2', {}, [
            h('label.text-xs.text-muted.uppercase.tracking-widest', {}, ['Risk']),
            h('div.flex.gap-2', {}, riskBtns),
          ]),
          h('div.flex.flex-col.gap-2', {}, [
            h('label.text-xs.text-muted.uppercase.tracking-widest', {}, ['Balls per drop']),
            h('div.flex.gap-2', {}, countBtns),
          ]),
          bet.el,
          dropBtn,
          h('div.text-xs.text-muted.leading-relaxed', {}, [
            '\u224897% RTP \u00b7 Server-side RNG \u00b7 Each ball settled independently.',
          ]),
        ]),
      ]),
    ])
  );
}

// ===========================================================================
// Geometry & rendering helpers (pure)
// ===========================================================================

function getGeom(w, h, rows) {
  const padX = 28;
  const padTop = 24;
  const padBot = 64;
  const nBins = rows + 1;
  const pegGapX = (w - padX * 2) / (nBins - 1);
  const pegGapY = (h - padTop - padBot) / (rows + 0.5);
  const binY = h - padBot + 6;
  return { padX, padTop, padBot, nBins, pegGapX, pegGapY, binY };
}

function getPegs(w, h, rows) {
  const { padX, padTop, padBot, nBins, pegGapX, pegGapY } = getGeom(w, h, rows);
  const pegs = [];
  for (let r = 0; r < rows; r++) {
    const y = padTop + r * pegGapY + (r === 0 ? 0 : pegGapY * 0.5);
    const c = r === 0 ? 1 : r + 1;
    const span = (c - 1) * pegGapX;
    const startX = (w - span) / 2;
    for (let i = 0; i < c; i++) {
      pegs.push({ x: startX + i * pegGapX, y, row: r, col: i });
    }
  }
  return { pegs, pegGapX, pegGapY, nBins, padX, padTop, padBot };
}

function closestPegInRow(pegs, row, x) {
  if (!Array.isArray(pegs) || pegs.length === 0) return null;
  let best = null, bestD = Infinity;
  for (const p of pegs) {
    if (p.row !== row) continue;
    const d = Math.abs(p.x - x);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

function drawBoard(ctx, w, h, rows, risk, binFlashes) {
  if (!Number.isFinite(w) || !Number.isFinite(h)) return;
  // Soft clear (the canvas background gradient is already on the element).
  ctx.clearRect(0, 0, w, h);

  // Glow halo at the top to anchor the eye where balls drop.
  const halo = ctx.createRadialGradient(w / 2, 4, 0, w / 2, 4, 120);
  halo.addColorStop(0, 'rgba(180,140,255,0.18)');
  halo.addColorStop(1, 'rgba(180,140,255,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, w, 120);

  const { pegs, nBins, padX, padBot } = getPegs(w, h, rows);
  const mults  = getPlinkoMults(rows, risk);
  const colors = getPlinkoColors(rows, risk);
  const binW   = (w - padX * 2) / nBins;
  const now    = performance.now();

  // Bins
  for (let i = 0; i < nBins; i++) {
    const x  = padX + i * binW;
    const y  = h - padBot + 6;
    const bw = binW - 2;
    const bh = padBot - 14;

    const flash = binFlashes[i];
    const flashAlpha = flash && flash.until > now
      ? Math.max(0, (flash.until - now) / 700)
      : 0;
    const baseFill = hexToRgba(colors[i], 0.10 + flashAlpha * 0.45);
    const baseStroke = hexToRgba(colors[i], 0.40 + flashAlpha * 0.55);

    if (flashAlpha > 0) {
      ctx.shadowColor = colors[i];
      ctx.shadowBlur  = 22 * flashAlpha;
    }
    ctx.fillStyle   = baseFill;
    ctx.strokeStyle = baseStroke;
    ctx.lineWidth   = flashAlpha > 0 ? 2.2 : 1;
    roundRectPath(ctx, x, y, bw, bh, 7);
    ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.fillStyle = colors[i];
    ctx.font = 'bold 13px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(formatMultiplier(mults[i]), x + bw / 2, y + bh / 2);
  }

  // Pegs with subtle 3D shading + outer glow
  for (const p of pegs) {
    // outer glow
    ctx.beginPath();
    ctx.arc(p.x, p.y, PEG_RADIUS + 2.8, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(180,150,255,0.06)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(p.x, p.y, PEG_RADIUS, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(p.x - 1, p.y - 1, 0.5, p.x, p.y, PEG_RADIUS);
    g.addColorStop(0, 'rgba(255,255,255,0.85)');
    g.addColorStop(1, 'rgba(180,170,210,0.35)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 0.7;
    ctx.stroke();
  }

  // Faint dividers between bins
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 0.8;
  for (let i = 1; i < nBins; i++) {
    const x = padX + i * binW;
    ctx.beginPath();
    ctx.moveTo(x, h - padBot + 6);
    ctx.lineTo(x, h - 8);
    ctx.stroke();
  }
}

function drawBall(ctx, bx, by, hue) {
  if (!isFinitePoint(bx, by)) return;
  // Outer glow
  ctx.beginPath();
  ctx.arc(bx, by, BALL_RADIUS + 6, 0, Math.PI * 2);
  ctx.fillStyle = hexToRgba(hue, 0.18);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(bx, by, BALL_RADIUS, 0, Math.PI * 2);
  const g = ctx.createRadialGradient(bx - 2, by - 2, 0.8, bx, by, BALL_RADIUS);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.55, '#e8e8f0');
  g.addColorStop(1, hexToRgba(hue, 0.85));
  ctx.fillStyle = g;
  ctx.shadowColor = hue;
  ctx.shadowBlur = 10;
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawTrail(ctx, ball) {
  const trail = ball.trail;
  if (trail.length < 2) return;
  for (let i = 0; i < trail.length - 1; i++) {
    const a = trail[i], b = trail[i + 1];
    if (!isFinitePoint(a.x, a.y) || !isFinitePoint(b.x, b.y)) return;
    const t = (i + 1) / trail.length;
    ctx.strokeStyle = hexToRgba(ball.hue, 0.12 + 0.45 * t);
    ctx.lineWidth = 1.5 + 2.4 * t;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
}

function drawPulse(ctx, p) {
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
  ctx.fillStyle = hexToRgba(p.color, p.opacity * 0.18);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(p.x, p.y, p.r * 0.55, 0, Math.PI * 2);
  ctx.fillStyle = hexToRgba(p.color, p.opacity * 0.40);
  ctx.fill();
}

function hexToRgba(hex, a) {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}

function isFinitePoint(x, y) {
  return Number.isFinite(x) && Number.isFinite(y);
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
