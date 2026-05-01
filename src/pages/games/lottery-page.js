/**
 * lottery-page.js
 * Neon Lotto — pick 5 numbers from 1-36, draw 5, match for multipliers.
 * Server-resolved draw, client animates balls tumbling out one by one.
 */
import { h, mount } from '../../utils/dom.js';
import { appShell } from '../../ui/layout/app-shell.js';
import { createBetInput } from '../../ui/components/bet-input.js';
import { playLottery, LOTTO_MIN, LOTTO_MAX, LOTTO_PICK_COUNT, LOTTO_PAYOUT, MATCH_COLORS } from '../../games/lottery/lottery-api.js';
import { userStore, patchProfile } from '../../state/user-store.js';
import { toastError } from '../../ui/components/toast.js';
import { validateBet } from '../../utils/validation.js';
import { formatCredits, formatMultiplier } from '../../utils/format.js';
import { GAMES } from '../../config/constants.js';
import { flashSuccess, flashSuccessMajor, flashGold, flashLoss } from '../../ui/fx/feedback-fx.js';

const GRID_SIZE = 6; // 6x6 = 36 numbers

export function renderLottery() {
  let picks = new Set();
  let busy = false;
  let history = [];
  let lastResult = null;

  const bet = createBetInput({ value: 25, min: GAMES.LOTTERY?.minBet ?? 1 });

  const root = h('div.flex.flex-col.gap-4', {}, []);
  const redraw = () => mount(root, view());

  // Grid cell refs for animation targeting
  const cellRefs = new Map();

  function view() {
    const resultArea = lastResult ? resultPanel(lastResult) : emptyResult();
    const drawArea = lastResult ? drawBalls(lastResult) : drawPlaceholder();

    return h('div.flex.flex-col.gap-4', {}, [
      h('div.flex.items-end.justify-between.gap-3.flex-wrap', {}, [
        h('div', {}, [
          h('h1.text-2xl.sm:text-3xl.font-semibold.heading-grad', {}, ['Neon Lotto']),
          h('p.text-xs.sm:text-sm.text-muted', {}, [
            'Pick 5 lucky numbers from 1-36. Match the drawn balls for up to 8,000×.',
          ]),
        ]),
        historyStrip(history),
      ]),

      h('div.grid.grid-cols-1.xl:grid-cols-3.gap-4', {}, [
        // LEFT: number grid + draw area (2 cols)
        h('div.xl:col-span-2.flex.flex-col.gap-4', {}, [
          h('div.glass.neon-border.p-3.sm:p-5.flex.flex-col.gap-4', {}, [
            numberGrid(),
            h('div.h-px.bg-white/5', {}, []),
            drawArea,
          ]),
          resultArea,
        ]),

        // RIGHT: controls + payout table
        h('div.flex.flex-col.gap-4', {}, [
          bet.el,
          h('div.flex.gap-2', {}, [
            h('button.btn-ghost.h-10.flex-1', {
              onclick: () => { if (!busy) { picks.clear(); redraw(); } },
              disabled: busy,
            }, ['Clear']),
            h('button.btn-ghost.h-10.flex-1', {
              onclick: () => { if (!busy) { autoPick(); redraw(); } },
              disabled: busy,
            }, ['Quick pick']),
          ]),
          lockButton(),
          payoutTable(),
          h('div.text-xs.text-muted', {}, ['~97% RTP · 5/36 format · Server-side RNG']),
        ]),
      ]),
    ]);
  }

  // -------------------------------------------------------------------------
  // Number grid
  // -------------------------------------------------------------------------
  function numberGrid() {
    const cells = [];
    for (let n = LOTTO_MIN; n <= LOTTO_MAX; n++) {
      const isPicked = picks.has(n);
      const isMatch = lastResult?.drawn?.includes(n) && picks.has(n);
      const isDrawn = lastResult?.drawn?.includes(n) && !picks.has(n);
      const wasMiss = lastResult && !lastResult.drawn.includes(n) && picks.has(n);

      const el = h('button.relative.transition-all.duration-200', {
        onclick: () => togglePick(n),
        disabled: busy,
        style: {
          aspectRatio: '1 / 1',
          borderRadius: '10px',
          fontSize: '15px',
          fontWeight: '700',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          border: isMatch
            ? '2px solid #ffd96b'
            : isPicked
              ? '2px solid #22c2ff'
              : '1px solid rgba(255,255,255,0.08)',
          background: isMatch
            ? 'linear-gradient(135deg, rgba(255,217,107,0.18), rgba(255,217,107,0.06))'
            : isDrawn
              ? 'linear-gradient(135deg, rgba(255,51,112,0.12), rgba(255,51,112,0.04))'
              : wasMiss
                ? 'linear-gradient(135deg, rgba(255,51,112,0.08), rgba(255,51,112,0.02))'
                : isPicked
                  ? 'linear-gradient(135deg, rgba(34,194,255,0.15), rgba(34,194,255,0.05))'
                  : 'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))',
          color: isMatch
            ? '#ffd96b'
            : isDrawn
              ? '#ff6d8a'
              : wasMiss
                ? '#ff6d8a'
                : isPicked
                  ? '#22c2ff'
                  : 'rgba(255,255,255,0.55)',
          boxShadow: isMatch
            ? '0 0 16px rgba(255,217,107,0.35), inset 0 0 8px rgba(255,217,107,0.1)'
            : isPicked
              ? '0 0 10px rgba(34,194,255,0.25), inset 0 0 6px rgba(34,194,255,0.08)'
              : 'none',
          transform: isMatch ? 'scale(1.06)' : 'scale(1)',
          cursor: busy ? 'default' : 'pointer',
        },
      }, [String(n).padStart(2, '0')]);

      cellRefs.set(n, el);
      cells.push(el);
    }

    return h('div.grid.gap-2', {
      style: { gridTemplateColumns: `repeat(${GRID_SIZE}, minmax(0, 1fr))` },
    }, cells);
  }

  function togglePick(n) {
    if (busy) return;
    if (picks.has(n)) {
      picks.delete(n);
    } else if (picks.size < LOTTO_PICK_COUNT) {
      picks.add(n);
    } else {
      toastError(`Pick exactly ${LOTTO_PICK_COUNT} numbers`);
      return;
    }
    redraw();
  }

  function autoPick() {
    picks.clear();
    const pool = Array.from({ length: LOTTO_MAX }, (_, i) => i + 1);
    for (let i = 0; i < LOTTO_PICK_COUNT; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      picks.add(pool[idx]);
      pool.splice(idx, 1);
    }
  }

  // -------------------------------------------------------------------------
  // Draw / result areas
  // -------------------------------------------------------------------------
  function drawPlaceholder() {
    return h('div.flex.items-center.justify-center.gap-3.py-6.text-muted.text-sm', {}, [
      h('span', {}, ['Pick 5 numbers and hit Lock & Draw to see the balls roll.']),
    ]);
  }

  function drawBalls(result) {
    const balls = result.drawn.map((n, i) => {
      const isMatch = picks.has(n);
      const delay = i * 0.12;
      return h('div.relative.flex.items-center.justify-center', {
        style: {
          width: '52px',
          height: '52px',
          borderRadius: '50%',
          fontSize: '18px',
          fontWeight: '800',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          color: isMatch ? '#1a1a2e' : 'rgba(255,255,255,0.7)',
          background: isMatch
            ? 'radial-gradient(circle at 32% 32%, #ffd96b, #c9a02a)'
            : 'radial-gradient(circle at 32% 32%, #e8e8f0, #8a8a9a)',
          boxShadow: isMatch
            ? '0 0 20px rgba(255,217,107,0.5), inset 0 0 6px rgba(255,255,255,0.4)'
            : '0 2px 6px rgba(0,0,0,0.3), inset 0 0 4px rgba(255,255,255,0.15)',
          transform: `translateY(${isMatch ? -4 : 0}px)`,
          animation: `lottoBallIn 500ms ${delay}s cubic-bezier(.2,1.3,.5,1) both`,
        },
      }, [String(n).padStart(2, '0')]);
    });

    return h('div.flex.flex-col.gap-3', {}, [
      h('div.text-[10px].uppercase.tracking-widest.text-muted', {}, ['Drawn numbers']),
      h('div.flex.items-center.justify-center.gap-3.py-2.flex-wrap', {}, balls),
    ]);
  }

  function emptyResult() {
    return h('div.h-8', {}, []);
  }

  function resultPanel(result) {
    const profit = result.payout - result.bet;
    const matchColor = MATCH_COLORS[result.matches];
    return h('div.flex.items-center.justify-between.gap-4.glass.neon-border.p-3', {}, [
      h('div.flex.items-center.gap-3', {}, [
        h('div.w-10.h-10.rounded-full.flex.items-center.justify-center.text-sm.font-bold', {
          style: {
            background: hexToRgba(matchColor, 0.15),
            border: `2px solid ${matchColor}55`,
            color: matchColor,
          },
        }, [String(result.matches)]),
        h('div.flex.flex-col', {}, [
          h('span.text-xs.text-muted.uppercase.tracking-widest', {}, [
            result.matches === 1 ? '1 match' : `${result.matches} matches`,
          ]),
          h('span.text-sm.font-mono.font-bold', { style: { color: matchColor } }, [
            formatMultiplier(result.multiplier),
          ]),
        ]),
      ]),
      h(`div.text-lg.font-mono.font-bold.${profit > 0 ? 'text-accent-lime' : profit < 0 ? 'text-accent-rose' : 'text-white/60'}`, {}, [
        profit === 0 ? 'Even' : `${profit > 0 ? '+' : ''}${formatCredits(profit)} cr`,
      ]),
    ]);
  }

  // -------------------------------------------------------------------------
  // Lock & Draw button
  // -------------------------------------------------------------------------
  function lockButton() {
    const count = picks.size;
    const full = count === LOTTO_PICK_COUNT;
    const label = full
      ? `Lock & Draw · ${formatCredits(bet.get())} cr`
      : `Pick ${LOTTO_PICK_COUNT - count} more…`;

    return h(
      `button.${full ? 'btn-primary' : 'btn-ghost'}.h-12.w-full.text-base`,
      {
        onclick: doDraw,
        disabled: busy || !full,
      },
      [busy ? 'Drawing…' : label]
    );
  }

  async function doDraw() {
    if (busy) return;
    if (picks.size !== LOTTO_PICK_COUNT) {
      toastError(`Pick exactly ${LOTTO_PICK_COUNT} numbers`);
      return;
    }
    const amount = bet.get();
    const err = validateBet(amount, userStore.get().profile?.credits);
    if (err) return toastError(err);

    busy = true;
    lastResult = null;
    redraw();

    let result;
    try {
      result = await playLottery(amount, Array.from(picks).sort((a, b) => a - b));
    } catch (e) {
      toastError(e.message);
      busy = false;
      redraw();
      return;
    }

    patchProfile({ credits: result.newBalance });
    result.bet = amount; // attach for display

    // Animate: draw balls one by one
    await animateDraw(result);

    lastResult = result;
    history = [result, ...history].slice(0, 16);

    const profit = result.payout - amount;
    if (result.matches >= 4) {
      flashGold({ label: `${result.matches} MATCHES` });
    } else if (result.matches >= 3) {
      flashSuccessMajor({ label: `+${formatCredits(profit)}` });
    } else if (profit > 0) {
      flashSuccess();
    } else {
      flashLoss();
    }

    busy = false;
    redraw();
  }

  // -------------------------------------------------------------------------
  // Draw animation — balls tumble out one by one with physics
  // -------------------------------------------------------------------------
  async function animateDraw(result) {
    const drawn = result.drawn;
    const matchSet = new Set(drawn.filter((n) => picks.has(n)));

    // Create a temporary ball chute overlay
    const chute = h('div.fixed.inset-0.z-50.flex.items-center.justify-center', {
      style: {
        background: 'rgba(10,10,16,0.85)',
        backdropFilter: 'blur(4px)',
      },
    }, [
      h('div.flex.flex-col.items-center.gap-6', {}, [
        h('div.text-xs.uppercase.tracking-widest.text-muted', {}, ['Drawing numbers…']),
        h('div.flex.items-center.gap-3', { id: 'lotto-ball-chute' }, []),
      ]),
    ]);

    document.body.appendChild(chute);
    const chuteContainer = chute.querySelector('#lotto-ball-chute');

    // Reveal balls one by one
    for (let i = 0; i < drawn.length; i++) {
      const n = drawn[i];
      const isMatch = picks.has(n);
      await sleep(650);

      const ball = createBallNode(n, isMatch, i);
      chuteContainer.appendChild(ball);

      // Trigger entrance animation
      requestAnimationFrame(() => {
        ball.style.transform = 'translateY(0) scale(1)';
        ball.style.opacity = '1';
      });

      // If it matches, pulse the grid cell too
      if (isMatch) {
        const cell = cellRefs.get(n);
        if (cell) {
          cell.style.animation = 'lottoGridPulse 600ms ease-out';
          setTimeout(() => { cell.style.animation = ''; }, 600);
        }
      }
    }

    await sleep(900);
    chute.style.opacity = '0';
    chute.style.transition = 'opacity 400ms';
    await sleep(450);
    chute.remove();
  }

  function createBallNode(n, isMatch, idx) {
    const el = h('div.flex.items-center.justify-center', {
      style: {
        width: '64px',
        height: '64px',
        borderRadius: '50%',
        fontSize: '22px',
        fontWeight: '800',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        color: isMatch ? '#1a1a2e' : 'rgba(255,255,255,0.8)',
        background: isMatch
          ? 'radial-gradient(circle at 32% 32%, #ffd96b, #c9a02a)'
          : 'radial-gradient(circle at 32% 32%, #e8e8f0, #7a7a8a)',
        boxShadow: isMatch
          ? '0 0 28px rgba(255,217,107,0.55), inset 0 0 8px rgba(255,255,255,0.4)'
          : '0 4px 12px rgba(0,0,0,0.4), inset 0 0 6px rgba(255,255,255,0.2)',
        transform: 'translateY(-120px) scale(0.3)',
        opacity: '0',
        transition: `transform 500ms ${idx * 0.08}s cubic-bezier(.2,1.3,.5,1), opacity 300ms`,
      },
    }, [String(n).padStart(2, '0')]);
    return el;
  }

  // -------------------------------------------------------------------------
  // Payout table
  // -------------------------------------------------------------------------
  function payoutTable() {
    const rows = [2, 3, 4, 5].map((m) => {
      const color = MATCH_COLORS[m];
      return h('div.flex.items-center.justify-between.py-1.5.px-3.rounded-md', {
        style: {
          background: hexToRgba(color, 0.06),
          border: `1px solid ${hexToRgba(color, 0.15)}`,
        },
      }, [
        h('span.text-xs.font-mono', { style: { color } }, [`${m} match${m === 1 ? '' : 'es'}`]),
        h('span.text-xs.font-mono.font-bold.text-white', {}, [formatMultiplier(LOTTO_PAYOUT[m])]),
      ]);
    });

    return h('div.glass.neon-border.p-4.flex.flex-col.gap-2', {}, [
      h('div.text-[10px].uppercase.tracking-widest.text-muted.mb-1', {}, ['Payouts']),
      ...rows,
    ]);
  }

  // -------------------------------------------------------------------------
  // History strip
  // -------------------------------------------------------------------------
  function historyStrip(items) {
    if (!items.length) {
      return h('div.text-xs.text-muted', {}, ['No draws yet']);
    }
    return h('div.flex.gap-2.flex-wrap.justify-end', {},
      items.slice(0, 8).map((r) => {
        const c = MATCH_COLORS[r.matches];
        return h('span.inline-flex.items-center.justify-center.rounded-md.px-2.py-1.text-[11px].font-mono', {
          style: {
            background: hexToRgba(c, 0.12),
            border: `1px solid ${hexToRgba(c, 0.35)}`,
            color: c,
          },
        }, [`${r.matches}m · ${formatMultiplier(r.multiplier)}`]);
      })
    );
  }

  // Inject keyframes if not already present
  injectStylesOnce();

  redraw();
  return appShell(root);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function hexToRgba(hex, a) {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}

let stylesInjected = false;
function injectStylesOnce() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    @keyframes lottoBallIn {
      from { transform: translateY(40px) scale(0.5); opacity: 0; }
      to   { transform: translateY(0) scale(1); opacity: 1; }
    }
    @keyframes lottoGridPulse {
      0%   { transform: scale(1); box-shadow: 0 0 0 rgba(255,217,107,0); }
      40%  { transform: scale(1.12); box-shadow: 0 0 24px rgba(255,217,107,0.6); }
      100% { transform: scale(1); box-shadow: 0 0 8px rgba(255,217,107,0.2); }
    }
  `;
  document.head.appendChild(style);
}
