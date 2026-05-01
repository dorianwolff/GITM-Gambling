/**
 * plinko-page.js
 * Stake-style peg board. Choose rows (8/10/12) and risk level, then drop.
 * Server resolves the full path; client animates the ball bouncing left/right.
 */
import { h, mount } from '../../utils/dom.js';
import { appShell } from '../../ui/layout/app-shell.js';
import { createBetInput } from '../../ui/components/bet-input.js';
import { playPlinko, PLINKO_ROWS, PLINKO_RISKS, getPlinkoMults, getPlinkoColors } from '../../games/plinko/plinko-api.js';
import { userStore, patchProfile } from '../../state/user-store.js';
import { toastError } from '../../ui/components/toast.js';
import { validateBet } from '../../utils/validation.js';
import { formatCredits, formatMultiplier } from '../../utils/format.js';
import { GAMES } from '../../config/constants.js';
import {
  flashSuccess, flashSuccessMajor, flashGold, flashLoss, flashLossMajor,
} from '../../ui/fx/feedback-fx.js';

export function renderPlinko() {
  let rows = 8;
  let risk = 'medium';
  let busy = false;
  let history = [];

  const bet = createBetInput({ value: 25, min: GAMES.PLINKO?.minBet ?? 1 });

  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
  const canvas = h('canvas.w-full.rounded-xl.bg-white/[0.02].border.border-white/5', {
    style: { display: 'block', maxHeight: '420px' },
  });
  function setCanvasSize() {
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(320, rect.width || 640);
    const cssH = Math.max(240, rect.height || Math.round(cssW * 0.75));
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    return { ctx, cssW, cssH };
  }

  const resultEl = h('div.text-2xl.font-mono.h-8.font-bold.text-white', {}, ['']);
  const historyEl = h('div.flex.gap-1.flex-wrap.justify-center.min-h-[28px]', {}, []);

  const rowBtns = PLINKO_ROWS.map((r) =>
    h('button.btn.flex-1.h-10', {
      onclick: () => { rows = r; refresh(); },
    }, [`${r} rows`])
  );

  const riskBtns = PLINKO_RISKS.map((r) =>
    h('button.btn.flex-1.h-10.capitalize', {
      onclick: () => { risk = r; refresh(); },
    }, [r])
  );

  function refresh() {
    const { ctx, cssW, cssH } = setCanvasSize();
    drawBoard(ctx, cssW, cssH, rows, risk, null, 0);
    rowBtns.forEach((b, i) => {
      b.className = `btn h-10 flex-1 ${PLINKO_ROWS[i] === rows ? 'btn-primary' : 'btn-ghost'}`;
    });
    riskBtns.forEach((b, i) => {
      b.className = `btn h-10 flex-1 capitalize ${PLINKO_RISKS[i] === risk ? 'btn-primary' : 'btn-ghost'}`;
    });
  }

  function renderHistory() {
    mount(
      historyEl,
      h('div.flex.gap-1.flex-wrap.justify-center', {},
        history.map((h_) =>
          h('span.inline-flex.items-center.justify-center.rounded-md.px-2.py-1.text-[11px].font-mono', {
            style: {
              background: h_.won ? 'rgba(0,255,170,0.12)' : 'rgba(255,0,80,0.12)',
              border: `1px solid ${h_.won ? 'rgba(0,255,170,0.35)' : 'rgba(255,0,80,0.35)'}`,
              color: h_.won ? '#00ffaa' : '#ff6d8a',
            },
          }, [formatMultiplier(h_.mult)])
        )
      )
    );
  }

  const dropBtn = h('button.btn-primary.h-12.w-full.text-base', {
    onclick: async () => {
      if (busy) return;
      const amount = bet.get();
      const err = validateBet(amount, userStore.get().profile?.credits);
      if (err) return toastError(err);

      busy = true;
      dropBtn.disabled = true;
      resultEl.textContent = '';

      let result;
      try {
        result = await playPlinko(amount, rows, risk);
      } catch (e) {
        toastError(e.message);
        busy = false;
        dropBtn.disabled = false;
        return;
      }

      patchProfile({ credits: result.newBalance });
      const { ctx, cssW, cssH } = setCanvasSize();
      await animateDrop(ctx, cssW, cssH, rows, risk, result.path, result.binIndex);

      const profit = result.payout - amount;
      resultEl.textContent = result.won
        ? `+${formatCredits(profit)} cr · ${formatMultiplier(result.multiplier)}`
        : `Lost ${formatCredits(amount)} cr · ${formatMultiplier(result.multiplier)}`;
      resultEl.className = 'text-2xl font-mono h-8 font-bold ' + (result.won ? 'text-accent-lime' : 'text-accent-rose');

      if (result.won) {
        if (result.multiplier >= 5) flashGold({ label: `${formatMultiplier(result.multiplier)}×` });
        else if (result.multiplier >= 2) flashSuccessMajor({ label: `+${formatCredits(profit)}` });
        else flashSuccess();
      } else {
        if (result.multiplier <= 0.2) flashLossMajor({ label: 'BUST', intense: true });
        else flashLoss();
      }

      history = [{ mult: result.multiplier, won: result.won, profit }, ...history].slice(0, 16);
      renderHistory();
      busy = false;
      dropBtn.disabled = false;
    },
  }, ['Drop ball']);

  refresh();

  return appShell(
    h('div.flex.flex-col.gap-4', {}, [
      h('h1.text-3xl.font-semibold.heading-grad', {}, ['Plinko']),
      h('p.text-sm.text-muted', {}, [
        'Drop a ball through the pegs. It bounces left and right randomly and lands in a multiplier slot. Riskier boards have bigger edges — and deadlier centres.',
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
          bet.el,
          dropBtn,
          h('div.text-xs.text-muted', {}, ['~96% RTP · Server-side RNG · Fair-play audited']),
        ]),
      ]),
    ])
  );
}

function getPegs(w, h, rows) {
  const padX = 28, padTop = 18, padBot = 64;
  const nBins = rows + 1;
  const pegGapX = (w - padX * 2) / (nBins - 1);
  const pegGapY = (h - padTop - padBot) / (rows + 0.5);
  const pegs = [];
  for (let r = 0; r <= rows; r++) {
    const y = padTop + r * pegGapY + (r === 0 ? 0 : pegGapY * 0.5);
    const count = r === 0 ? 1 : r + 1;
    const span = (count - 1) * pegGapX;
    const startX = (w - span) / 2;
    for (let i = 0; i < count; i++) {
      pegs.push({ x: startX + i * pegGapX, y, row: r, col: i });
    }
  }
  return { pegs, pegGapX, pegGapY, nBins, padX, padTop, padBot };
}

function drawBoard(ctx, w, h, rows, risk, highlightBin = null, glow = 0) {
  ctx.clearRect(0, 0, w, h);
  const { pegs, nBins, padX, padTop, padBot } = getPegs(w, h, rows);
  const mults = getPlinkoMults(rows, risk);
  const colors = getPlinkoColors(rows, risk);

  // bin backgrounds
  const binW = (w - padX * 2) / nBins;
  for (let i = 0; i < nBins; i++) {
    const x = padX + i * binW;
    const y = h - padBot + 6;
    const bw = binW - 2;
    const bh = padBot - 14;
    const isHL = highlightBin === i;
    ctx.fillStyle = isHL
      ? hexToRgba(colors[i], 0.22 + glow * 0.35)
      : hexToRgba(colors[i], 0.10);
    ctx.strokeStyle = isHL
      ? hexToRgba(colors[i], 0.75 + glow * 0.25)
      : hexToRgba(colors[i], 0.40);
    ctx.lineWidth = isHL ? 2.2 : 1;
    if (isHL) {
      ctx.shadowColor = colors[i];
      ctx.shadowBlur = 18 * glow;
    }
    roundRectPath(ctx, x, y, bw, bh, 6);
    ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.fillStyle = colors[i];
    ctx.font = 'bold 13px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(formatMultiplier(mults[i]), x + bw / 2, y + bh / 2);
  }

  // pegs with subtle 3D shading
  for (const p of pegs) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.8, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(p.x - 1, p.y - 1, 0.5, p.x, p.y, 3.8);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(200,200,220,0.18)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }

  // faint vertical dividers
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 0.8;
  for (let i = 1; i < nBins; i++) {
    const x = padX + i * binW;
    ctx.beginPath();
    ctx.moveTo(x, h - padBot + 6);
    ctx.lineTo(x, h - 8);
    ctx.stroke();
  }
}

function drawBall(ctx, bx, by) {
  ctx.beginPath();
  ctx.arc(bx, by, 5.5, 0, Math.PI * 2);
  const g = ctx.createRadialGradient(bx - 2, by - 2, 0.8, bx, by, 5.5);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.55, '#e8e8f0');
  g.addColorStop(1, '#8a8a9a');
  ctx.fillStyle = g;
  ctx.shadowColor = 'rgba(255,255,255,0.55)';
  ctx.shadowBlur = 14;
  ctx.fill();
  ctx.shadowBlur = 0;
}

/* ---------- choreographed peg-to-peg drop ---------- */

async function animateDrop(ctx, w, h, rows, risk, path, finalBin) {
  const { pegs, nBins, padX, padTop, padBot } = getPegs(w, h, rows);
  const binW = (w - padX * 2) / nBins;

  // Build exact waypoint sequence from server path
  const waypoints = [];
  let col = 0;
  const top = pegs.find(p => p.row === 0);

  // 1. start above the top peg
  waypoints.push({
    x: top.x,
    y: top.y - 24,
    dur: 420,
    arc: 0,
    isBounce: false,
  });

  // 2. hit the top peg
  waypoints.push({
    x: top.x,
    y: top.y,
    dur: 260,
    arc: 0,
    isBounce: false,
  });

  // 3. each subsequent peg from server's path
  for (let row = 0; row < rows; row++) {
    if (path[row]) col += 1;
    const peg = pegs.find(p => p.row === row + 1 && p.col === col);
    if (!peg) continue;

    const prev = waypoints[waypoints.length - 1];
    const dx = peg.x - prev.x;
    const dy = peg.y - prev.y;
    // sideways hops take slightly longer; big drops feel fast
    const dur = 380 + Math.abs(dx) * 0.25;
    // arc height: bigger for sideways bounces, small for straight drops
    const arc = Math.abs(dx) * 0.55 + Math.max(0, -dy * 0.12) + 2;
    // small random scatter so every drop feels slightly different
    const arcVar = 1 + (Math.random() - 0.5) * 0.25;

    waypoints.push({
      x: peg.x,
      y: peg.y,
      dur: Math.round(dur),
      arc: arc * arcVar,
      isBounce: Math.abs(dx) > 0.5,
    });
  }

  // 4. final drop into bin
  const targetX = padX + finalBin * binW + binW / 2;
  const targetY = h - padBot + 6 + (padBot - 14) / 2;
  waypoints.push({
    x: targetX,
    y: targetY,
    dur: 550,
    arc: 0,
    isBounce: false,
  });

  // Animate through waypoints one by one
  let from = waypoints[0];
  for (let i = 1; i < waypoints.length; i++) {
    const to = waypoints[i];
    await tweenHop(ctx, w, h, rows, risk, from.x, from.y, to.x, to.y, to.dur, to.arc);
    from = to;
  }

  // highlight landing bin
  drawBoard(ctx, w, h, rows, risk, finalBin, 1.0);
  drawBall(ctx, targetX, targetY);
  await sleep(500);
}

/**
 * Tween between two points with a parabolic bounce arc.
 * The ball follows a curve that arcs UP from the straight-line path,
 * creating a natural "bounce off the peg" look.
 */
function tweenHop(ctx, w, h, rows, risk, x1, y1, x2, y2, duration, arcHeight) {
  return new Promise((resolve) => {
    const t0 = performance.now();

    function tick() {
      const raw = Math.min(1, (performance.now() - t0) / duration);

      // ease-in-out for x: starts slow, moves, slows at peg
      const p = raw < 0.5
        ? 4 * raw * raw * raw
        : 1 - Math.pow(-2 * raw + 2, 3) / 2;

      const bx = x1 + (x2 - x1) * p;

      // y: straight-line fall plus a parabolic arc that peaks at mid-point
      // arc goes UP (smaller y value) to look like a bounce
      const straightY = y1 + (y2 - y1) * p;
      const arc = arcHeight * Math.sin(Math.PI * p) * (1 - p * 0.3);
      const by = straightY - arc;

      drawBoard(ctx, w, h, rows, risk, null, 0);
      drawBall(ctx, bx, by);

      if (raw < 1) {
        requestAnimationFrame(tick);
      } else {
        // snap to exact end position for clean stops
        drawBoard(ctx, w, h, rows, risk, null, 0);
        drawBall(ctx, x2, y2);
        resolve();
      }
    }
    requestAnimationFrame(tick);
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function hexToRgba(hex, a) {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
