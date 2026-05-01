/**
 * mines-page.js
 * Money démineur. 5×5 grid, choose mine count, reveal tiles to stack
 * multiplier, cash out any time (except before first reveal). A bust
 * wipes the stake and reveals every mine for the traditional "oh no"
 * moment; a cashout flies confetti.
 *
 * Every state mutation is round-tripped through the server — the client
 * never knows where the mines are until a bust, so there is no possible
 * client-side cheat. On page load we probe `minesweeper_active` so a
 * tab reload resumes the user's game in-place instead of silently
 * abandoning it.
 */
import { h, mount } from '../../utils/dom.js';
import { appShell } from '../../ui/layout/app-shell.js';
import { userStore, patchProfile } from '../../state/user-store.js';
import { toastError, toastSuccess } from '../../ui/components/toast.js';
import { formatCredits } from '../../utils/format.js';
import {
  minesStart, minesReveal, minesCashout, minesActive,
  minesMultiplier, MINES_TOTAL_CELLS,
} from '../../games/mines/mines-api.js';
import {
  flashSuccess, flashSuccessMajor, flashGold, flashLoss,
} from '../../ui/fx/feedback-fx.js';

const GRID = 5;

const MINES_CHOICES = [1, 3, 5, 10, 15, 20, 24];
const BET_CHOICES   = [10, 25, 50, 100, 250, 500];

export function renderMines(ctx) {
  const root = h('div.flex.flex-col.gap-6', {}, []);

  // --- View state
  let bet        = 50;
  let minesCount = 3;
  // In-progress game (server-side mirror). null = no active game.
  /** @type {null|{id:string, bet:number, mines:number, revealed:number[],
   *               multBp:number, potentialPayout:number,
   *               status:'active'|'busted'|'cashed_out',
   *               minesRevealed?:number[]}} */
  let game = null;
  let busy = false;

  const redraw = () => mount(root, view());

  // --- Resume any in-flight game on mount.
  minesActive()
    .then((row) => {
      if (row) {
        game = { ...row, status: 'active', minesRevealed: [] };
        bet = row.bet;
        minesCount = row.mines;
      }
      redraw();
    })
    .catch(() => { /* silent — treat as no game */ redraw(); });

  // --- Actions
  async function handleStart() {
    if (busy) return;
    const credits = userStore.get().profile?.credits ?? 0;
    if (credits < bet) return toastError(`Not enough credits (need ${bet})`);
    busy = true; redraw();
    try {
      const r = await minesStart(bet, minesCount);
      patchProfile({ credits: r.newBalance });
      game = {
        id: r.id,
        bet: r.bet,
        mines: r.mines,
        revealed: [],
        multBp: 10000,
        potentialPayout: r.bet,
        status: 'active',
        minesRevealed: [],
      };
    } catch (e) {
      toastError(e.message);
    } finally {
      busy = false;
      redraw();
    }
  }

  async function handleReveal(cell) {
    if (busy || !game || game.status !== 'active') return;
    if (game.revealed.includes(cell)) return;
    busy = true; redraw();
    try {
      const r = await minesReveal(game.id, cell);
      patchProfile({ credits: r.newBalance });
      if (r.hitMine) {
        game = {
          ...game,
          revealed: r.revealed,
          minesRevealed: r.minesRevealed,
          status: 'busted',
          multBp: 0,
          potentialPayout: 0,
        };
        flashLoss({ label: '💥 BUSTED' });
        toastError(`Bust — lost ${formatCredits(bet)} cr`);
      } else {
        game = {
          ...game,
          revealed: r.revealed,
          multBp: r.multBp,
          potentialPayout: r.potentialPayout,
        };
        // Tier the feedback by current multiplier so early reveals feel
        // mild but a 10x+ stack really pops.
        const m = r.currentMulti;
        if (m >= 10)      flashGold({ label: `${m.toFixed(2)}× stacked` });
        else if (m >= 3)  flashSuccessMajor();
        else              flashSuccess();
      }
    } catch (e) {
      toastError(e.message);
    } finally {
      busy = false;
      redraw();
    }
  }

  async function handleCashout() {
    if (busy || !game || game.status !== 'active') return;
    if (!game.revealed.length) return toastError('Reveal at least one tile first');
    busy = true; redraw();
    try {
      const r = await minesCashout(game.id);
      patchProfile({ credits: r.newBalance });
      game = {
        ...game,
        status: 'cashed_out',
        potentialPayout: r.payout,
        minesRevealed: r.minesRevealed,
      };
      const m = r.multBp / 10000;
      if (m >= 10)      flashGold({ label: `+${formatCredits(r.payout)} cr · ${m.toFixed(2)}×` });
      else if (m >= 3)  flashSuccessMajor({ label: `+${formatCredits(r.payout)} cr` });
      else              flashSuccess({ label: `+${formatCredits(r.payout)} cr` });
      toastSuccess(`Cashed out ${formatCredits(r.payout)} cr @ ${m.toFixed(2)}×`);
    } catch (e) {
      toastError(e.message);
    } finally {
      busy = false;
      redraw();
    }
  }

  function handleNewRound() {
    game = null;
    redraw();
  }

  // --- View
  function view() {
    const credits = userStore.get().profile?.credits ?? 0;
    const isOver  = !!game && game.status !== 'active';
    const active  = !!game && game.status === 'active';

    // Preview multiplier for the NEXT reveal, used in the "next tile"
    // indicator — not the current multiplier which comes from the server.
    const nextMulti = active
      ? minesMultiplier(game.mines, game.revealed.length + 1)
      : minesMultiplier(minesCount, 1);
    const currentMulti = game ? game.multBp / 10000 : 1;

    return h('div.flex.flex-col.gap-6', {}, [
      h('div.flex.items-end.justify-between.gap-3.flex-wrap', {}, [
        h('div', {}, [
          h('h1.text-2xl.sm:text-3xl.font-semibold.heading-grad', {}, ['Mines']),
          h('p.text-xs.sm:text-sm.text-muted.max-w-2xl', {}, [
            'Pick safe tiles. The more mines, the higher the reward. Stop any time — one wrong click and the whole stake is gone.',
          ]),
        ]),
        h('div.text-right.flex.flex-col.gap-1', {}, [
          h('span.text-[10px].text-muted.uppercase.tracking-widest', {}, ['Balance']),
          h('span.font-mono.text-base.sm:text-lg.text-accent-cyan', {}, [`${formatCredits(credits)} cr`]),
        ]),
      ]),

      h('div.grid.grid-cols-1.lg:grid-cols-3.gap-4', {}, [
        // LEFT 2/3 — grid
        h('div.lg:col-span-2.glass.neon-border.p-3.sm:p-6.flex.flex-col.gap-4', {}, [
          h('div.flex.items-center.justify-between.text-xs.text-muted.uppercase.tracking-widest', {}, [
            h('span', {}, [active ? 'Active field' : isOver ? (game.status === 'busted' ? 'Busted' : 'Cashed out') : 'Set bet, then start']),
            h('span.font-mono', {}, [
              active
                ? `${game.revealed.length} / ${MINES_TOTAL_CELLS - game.mines} safe revealed`
                : '',
            ]),
          ]),
          gridView({
            game,
            onReveal: handleReveal,
            busy,
          }),
          active
            ? h('div.grid.grid-cols-3.gap-3.mt-2', {}, [
                statBox('Current', `${currentMulti.toFixed(2)}×`, 'text-accent-cyan'),
                statBox('Next tile', `${nextMulti.toFixed(2)}×`, 'text-accent-lime'),
                statBox('If cash out', `${formatCredits(game.potentialPayout)} cr`, 'text-accent-amber'),
              ])
            : null,
        ]),

        // RIGHT 1/3 — controls
        h('div.glass.neon-border.p-4.sm:p-6.flex.flex-col.gap-4', {}, [
          active
            ? h(
                'button.btn-primary.h-12.w-full.text-base',
                { onclick: handleCashout, disabled: busy || game.revealed.length === 0 },
                [busy ? 'Cashing out…' : `Cash out · ${formatCredits(game.potentialPayout)} cr`]
              )
            : null,
          active
            ? h('p.text-[11px].text-muted.text-center', {}, [
                'Cashout banks the current multiplier. Leaving the page forfeits the game.',
              ])
            : null,

          isOver
            ? h(
                'button.btn-primary.h-12.w-full.text-base',
                { onclick: handleNewRound },
                ['New round →']
              )
            : null,

          // Setup (only when no active game)
          !game
            ? h('div.flex.flex-col.gap-3', {}, [
                h('h3.text-xs.text-muted.uppercase.tracking-widest', {}, ['Setup']),
                h('label.text-[11px].text-muted.uppercase.tracking-widest', {}, ['Bet']),
                h('div.flex.flex-wrap.gap-1', {},
                  BET_CHOICES.map((v) => chip(String(v), bet === v, () => { bet = v; redraw(); }))
                ),
                h('input.input', {
                  type: 'number', min: 1, step: 1, value: bet,
                  oninput: (e) => {
                    const n = parseInt(e.target.value, 10);
                    if (Number.isFinite(n) && n >= 1) { bet = n; redraw(); }
                  },
                }),
                h('label.text-[11px].text-muted.uppercase.tracking-widest.mt-2', {}, ['Mines']),
                h('div.flex.flex-wrap.gap-1', {},
                  MINES_CHOICES.map((v) => chip(String(v), minesCount === v, () => { minesCount = v; redraw(); }))
                ),
                h('div.text-[11px].text-muted.font-mono', {}, [
                  `First reveal pays ${minesMultiplier(minesCount, 1).toFixed(2)}× · `,
                  `5 safe reveals: ${minesMultiplier(minesCount, 5).toFixed(2)}×`,
                ]),
                h(
                  'button.btn-primary.h-12.w-full.text-base.mt-2',
                  {
                    onclick: handleStart,
                    disabled: busy || credits < bet,
                  },
                  [busy ? 'Starting…' : `Start · ${formatCredits(bet)} cr`]
                ),
              ])
            : null,

          h('div.text-[11px].text-muted.leading-relaxed.mt-2.border-t.border-white/5.pt-3', {}, [
            'Multiplier ladder scales with mines: more mines = steeper climb, higher bust rate. House edge ≈ 3%. Leaving this page while a game is active forfeits the bet.',
          ]),
        ]),
      ]),
    ]);
  }

  redraw();
  return appShell(root);
}

// --- Subviews --------------------------------------------------------------

function statBox(label, value, color) {
  return h(
    'div.glass.rounded-lg.p-2.sm:p-3.flex.flex-col.gap-1.text-center',
    {},
    [
      h('span.text-[9px].sm:text-[10px].text-muted.uppercase.tracking-widest', {}, [label]),
      h(`span.font-mono.text-sm.sm:text-lg.${color}`, {}, [value]),
    ]
  );
}

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

function gridView({ game, onReveal, busy }) {
  const rows = [];
  for (let r = 0; r < GRID; r++) {
    const cells = [];
    for (let c = 0; c < GRID; c++) {
      const idx = r * GRID + c;
      cells.push(tileView(idx, game, onReveal, busy));
    }
    rows.push(h('div.flex.gap-1.5.sm:gap-2', {}, cells));
  }
  return h('div.flex.flex-col.gap-1.5.sm:gap-2.items-center', {}, rows);
}

function tileView(idx, game, onReveal, busy) {
  const isRevealedSafe = !!game && game.revealed.includes(idx);
  const isBustedMine   = !!game && game.status === 'busted'
                         && (game.minesRevealed ?? []).includes(idx);
  const isOver         = !!game && game.status !== 'active';
  // Reveal mines on cashout too, so the user sees what they dodged.
  const isDodgedMine   = !!game && game.status === 'cashed_out'
                         && (game.minesRevealed ?? []).includes(idx);

  let bg = 'rgba(255,255,255,0.04)';
  let content = '';
  let border = '1px solid rgba(255,255,255,0.08)';
  let glow = '';

  if (isRevealedSafe) {
    bg = 'linear-gradient(145deg, rgba(122,253,160,0.25), rgba(122,253,160,0.08))';
    border = '1px solid rgba(122,253,160,0.6)';
    glow = '0 0 12px rgba(122,253,160,0.35)';
    content = '💎';
  } else if (isBustedMine) {
    bg = 'linear-gradient(145deg, rgba(255,90,120,0.4), rgba(255,90,120,0.15))';
    border = '1px solid rgba(255,90,120,0.75)';
    glow = '0 0 16px rgba(255,90,120,0.6)';
    content = '💣';
  } else if (isDodgedMine) {
    bg = 'rgba(255,90,120,0.18)';
    border = '1px solid rgba(255,90,120,0.35)';
    content = '💣';
  } else if (isOver) {
    // Unrevealed, non-mine after game over — fade it out.
    bg = 'rgba(255,255,255,0.02)';
  }

  const interactive = !!game && game.status === 'active' && !isRevealedSafe && !busy;
  return h(
    'button.rounded-lg.w-12.h-12.sm:w-14.sm:h-14.md:w-16.md:h-16.flex.items-center.justify-center.text-xl.sm:text-2xl.transition-transform',
    {
      onclick: interactive ? () => onReveal(idx) : null,
      disabled: !interactive,
      style: {
        background: bg,
        border,
        boxShadow: glow,
        cursor: interactive ? 'pointer' : 'default',
        transform: isRevealedSafe ? 'scale(1)' : '',
      },
    },
    [content]
  );
}
