/**
 * candy-page.js
 * Match-3 "spin" where the server resolves an entire cascade sequence
 * up-front and the client replays it as an animation. The player sees:
 *   1. Initial 6×6 board drops in gem-by-gem (reveal cascade).
 *   2. For each server-side round:
 *      a. Matched cells pulse and pop with a rarity-ish glow.
 *      b. Payout ticker animates the running total upward.
 *      c. Board refills; new gems drop in from the top.
 *   3. Final total shown + confetti if won.
 *
 * The server decides every outcome; the client is a pure renderer of the
 * snapshot stream. That's what lets a slow network still show the exact
 * same total as the live balance — no divergence possible.
 */
import { h, mount } from '../../utils/dom.js';
import { appShell } from '../../ui/layout/app-shell.js';
import { userStore, patchProfile } from '../../state/user-store.js';
import { toastError, toastSuccess } from '../../ui/components/toast.js';
import { formatCredits } from '../../utils/format.js';
import {
  candySpin, CANDY_GEMS, CANDY_ROWS, CANDY_COLS, CANDY_CELLS,
} from '../../games/candy/candy-api.js';
import {
  flashSuccess, flashSuccessMajor, flashGold, flashLoss,
} from '../../ui/fx/feedback-fx.js';

// Animation cadence (ms). Tight enough for a snappy game, loose enough
// that each cascade step is clearly distinct visually.
const DROP_IN_DELAY_PER_COL = 40;
const MATCH_FLASH_MS = 500;
const REFILL_DROP_MS = 450;

const BET_CHOICES = [10, 25, 50, 100, 250, 500];

const GEM_COLORS = [
  '#ff5f7e', // 0 cherry
  '#ffd33b', // 1 lemon
  '#b366ff', // 2 grape
  '#5adb6f', // 3 apple
  '#5aa9ff', // 4 blueberry
  '#ff7bd6', // 5 candy
];

export function renderCandy(ctx) {
  const root = h('div.flex.flex-col.gap-6', {}, []);

  let bet      = 50;
  let busy     = false;
  /** @type {number[]} */ let board = [];          // length 36, values 0..5 or -1
  /** @type {Set<number>} */ let matchedCells = new Set(); // highlighted this frame
  let runningPayout = 0;
  let finalPayout   = null;   // null = no spin yet, 0 = loss, >0 = win
  let lastCascades  = 0;

  ctx.onCleanup(() => {});

  const redraw = () => mount(root, view());

  async function handleSpin() {
    if (busy) return;
    const credits = userStore.get().profile?.credits ?? 0;
    if (credits < bet) return toastError(`Not enough credits (need ${bet})`);

    busy = true;
    board = [];
    matchedCells = new Set();
    runningPayout = 0;
    finalPayout = null;
    redraw();

    let result;
    try {
      result = await candySpin(bet);
    } catch (e) {
      busy = false;
      redraw();
      return toastError(e.message);
    }

    patchProfile({ credits: result.newBalance });
    lastCascades = result.cascades;

    // Replay snapshots.
    for (const snap of result.snapshots) {
      if (snap.kind === 'initial') {
        await animateDropIn(snap.board);
      } else if (snap.kind === 'match') {
        matchedCells = new Set(snap.cells ?? []);
        // Paint matches on top of the pre-match board to make sure the
        // highlighted gems are the ones that are about to disappear.
        board = snap.board_before ?? board;
        redraw();
        await sleep(MATCH_FLASH_MS);
        // Tick the running payout upward in discrete chunks so the
        // counter visibly climbs rather than snapping.
        const targetPay = runningPayout + (snap.round_pay ?? 0);
        await animateCounter(runningPayout, targetPay, (v) => {
          runningPayout = v;
          redraw();
        });
        runningPayout = targetPay;
        // Fire tiered FX based on this cascade's size.
        const n = (snap.cells ?? []).length;
        if (n >= 12)      flashGold({ label: `MEGA CASCADE · +${formatCredits(snap.round_pay)} cr` });
        else if (n >= 8)  flashSuccessMajor({ label: `+${formatCredits(snap.round_pay)} cr` });
        else if (n >= 3)  flashSuccess();
        matchedCells = new Set();
        redraw();
      } else if (snap.kind === 'refill') {
        // Animate gravity: replace the board (-1s present) and wait a
        // beat for the drop-in animation defined in CSS to play.
        board = snap.board ?? board;
        redraw();
        await sleep(REFILL_DROP_MS);
      }
    }

    finalPayout = result.payout;

    if (result.payout > bet * 2) {
      flashGold({ label: `+${formatCredits(result.payout)} cr · ${result.cascades} cascades` });
      toastSuccess(`Huge! +${formatCredits(result.payout)} cr`);
    } else if (result.payout > bet) {
      flashSuccessMajor({ label: `+${formatCredits(result.payout)} cr` });
      toastSuccess(`+${formatCredits(result.payout)} cr`);
    } else if (result.payout > 0) {
      flashSuccess({ label: `+${formatCredits(result.payout)} cr` });
    } else {
      flashLoss({ label: `−${formatCredits(bet)} cr` });
    }

    busy = false;
    redraw();
  }

  async function animateDropIn(finalBoard) {
    // Reveal column by column, then redraw with the full board. This
    // uses the CSS `.candy-drop` animation applied via a key on the cell.
    board = Array(CANDY_CELLS).fill(-1);
    redraw();
    for (let c = 0; c < CANDY_COLS; c++) {
      for (let r = 0; r < CANDY_ROWS; r++) {
        const idx = r * CANDY_COLS + c;
        board[idx] = finalBoard[idx];
      }
      redraw();
      await sleep(DROP_IN_DELAY_PER_COL);
    }
  }

  function view() {
    const credits = userStore.get().profile?.credits ?? 0;
    return h('div.flex.flex-col.gap-6', {}, [
      h('div.flex.items-end.justify-between.gap-3.flex-wrap', {}, [
        h('div', {}, [
          h('h1.text-2xl.sm:text-3xl.font-semibold.heading-grad', {}, ['Candy']),
          h('p.text-xs.sm:text-sm.text-muted.max-w-2xl', {}, [
            'Match-3 cascades. Every run of three or more gems clears. Cleared gems fall, refill from the top, and match again for chain bonuses.',
          ]),
        ]),
        h('div.text-right.flex.flex-col.gap-1', {}, [
          h('span.text-[10px].text-muted.uppercase.tracking-widest', {}, ['Balance']),
          h('span.font-mono.text-base.sm:text-lg.text-accent-cyan', {}, [`${formatCredits(credits)} cr`]),
        ]),
      ]),

      h('div.grid.grid-cols-1.lg:grid-cols-3.gap-4', {}, [
        // LEFT 2/3 — board
        h('div.lg:col-span-2.glass.neon-border.p-3.sm:p-6.flex.flex-col.gap-4.items-center', {}, [
          h('div.w-full.flex.items-center.justify-between.text-xs.text-muted.uppercase.tracking-widest', {}, [
            h('span', {}, [finalPayout != null ? `${lastCascades} cascades` : busy ? 'Cascading…' : 'Idle']),
            h('span.font-mono', {},
              finalPayout != null
                ? [runningPayout > 0
                    ? `+${formatCredits(runningPayout)} cr`
                    : `−${formatCredits(bet)} cr`]
                : runningPayout > 0
                  ? [`+${formatCredits(runningPayout)} cr so far`]
                  : ['']
            ),
          ]),
          boardView(board, matchedCells),
        ]),

        // RIGHT 1/3 — controls
        h('div.glass.neon-border.p-4.sm:p-6.flex.flex-col.gap-4', {}, [
          h('h3.text-xs.text-muted.uppercase.tracking-widest', {}, ['Bet']),
          h('div.flex.flex-wrap.gap-1', {},
            BET_CHOICES.map((v) => chip(String(v), bet === v, () => { bet = v; redraw(); }))
          ),
          h('input.input', {
            type: 'number', min: 1, step: 1, value: bet, disabled: busy,
            oninput: (e) => {
              const n = parseInt(e.target.value, 10);
              if (Number.isFinite(n) && n >= 1) { bet = n; redraw(); }
            },
          }),
          h(
            'button.btn-primary.h-12.w-full.text-base',
            { onclick: handleSpin, disabled: busy || credits < bet },
            [busy ? 'Spinning…' : `Spin · ${formatCredits(bet)} cr`]
          ),
          h('div.text-[11px].text-muted.leading-relaxed.mt-1.border-t.border-white/5.pt-3', {}, [
            'Payout tiers: 3-match pays small, 4+ pays more, 5+ pays big, 12+ in a single cascade hits a mega-bonus. House edge ≈ 6%; variance is high because chain reactions compound.',
          ]),
        ]),
      ]),
    ]);
  }

  redraw();
  return appShell(root);
}

// ---------------------------------------------------------------------------

function chip(label, selected, onclick) {
  return h(
    'button.px-3.h-9.rounded-lg.text-sm.font-mono.font-bold.transition-colors',
    {
      onclick,
      style: {
        background: selected ? 'rgba(34,225,255,0.15)' : 'rgba(255,255,255,0.03)',
        border: selected ? '1px solid #22e1ff' : '1px solid rgba(255,255,255,0.08)',
        color: selected ? '#22e1ff' : '#fff',
      },
    },
    [label]
  );
}

function boardView(board, matched) {
  if (!board.length) {
    return h(
      'div.w-full.aspect-square.max-w-md.rounded-2xl.border.border-dashed.border-white/10.flex.items-center.justify-center.text-muted.text-sm',
      {},
      ['Press Spin to drop the board.']
    );
  }
  const rows = [];
  for (let r = 0; r < CANDY_ROWS; r++) {
    const cells = [];
    for (let c = 0; c < CANDY_COLS; c++) {
      const idx = r * CANDY_COLS + c;
      cells.push(cellView(idx, board[idx], matched.has(idx)));
    }
    rows.push(h('div.flex.gap-1.sm:gap-1.5', {}, cells));
  }
  return h('div.flex.flex-col.gap-1.sm:gap-1.5.p-2.sm:p-3.rounded-2xl.bg-black/30.border.border-white/5', {}, rows);
}

function cellView(idx, color, highlighted) {
  const empty = color == null || color < 0;
  const glyph = empty ? '' : CANDY_GEMS[color];
  const tint  = empty ? 'transparent' : GEM_COLORS[color];
  return h(
    'div.w-9.h-9.sm:w-11.sm:h-11.md:w-12.md:h-12.flex.items-center.justify-center.rounded-lg.text-xl.sm:text-2xl.transition-transform',
    {
      style: {
        background: empty
          ? 'rgba(255,255,255,0.02)'
          : `radial-gradient(circle at 30% 30%, ${tint}cc, ${tint}55 65%, ${tint}22)`,
        border: empty
          ? '1px dashed rgba(255,255,255,0.04)'
          : `1px solid ${tint}99`,
        boxShadow: highlighted ? `0 0 16px ${tint}, 0 0 4px ${tint} inset` : '',
        animation: highlighted ? 'candy-pop 0.45s ease-in-out infinite' : '',
        transform: highlighted ? 'scale(1.08)' : '',
      },
    },
    [glyph]
  );
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Animate a number from `from` → `to` in about ~600ms, calling `onTick` with
// intermediate integer values. Keeps the payout counter feeling alive.
async function animateCounter(from, to, onTick) {
  if (to <= from) return;
  const steps = 18;
  for (let i = 1; i <= steps; i++) {
    const v = Math.round(from + (to - from) * (i / steps));
    onTick(v);
    await sleep(32);
  }
}
