/**
 * roulette-page.js
 * European single-zero roulette. Server is authoritative — the page
 * collects bets, sends them as one RPC, then animates the wheel/ball
 * landing on the server-decided number.
 *
 * Bets supported (matches play_roulette in schema.sql):
 *   - 'number'  value=0..36         payout 36×
 *   - 'red' / 'black'                              2×
 *   - 'even' / 'odd'                               2×
 *   - 'low' (1-18) / 'high' (19-36)                2×
 *   - 'dozen'  value=1|2|3                         3×
 *   - 'column' value=1|2|3                         3×
 */
import { h, mount } from '../../utils/dom.js';
import { appShell } from '../../ui/layout/app-shell.js';
import { playRoulette, colorOf, WHEEL_ORDER } from '../../games/roulette/roulette-api.js';
import { userStore, patchProfile } from '../../state/user-store.js';
import { toastError, toastSuccess } from '../../ui/components/toast.js';
import { formatCredits } from '../../utils/format.js';
import { flashSuccess, flashSuccessMajor, flashGold, flashLoss } from '../../ui/fx/feedback-fx.js';

const CHIP_VALUES = [1, 5, 25, 100, 500];

export function renderRoulette() {
  /** @type {Array<{type:string,value:string|number,amount:number,id:string}>} */
  let bets = [];
  /** @type {Array<{type:string,value:string|number,amount:number,id:string}>} */
  let lastBets = [];
  let chip = 25;
  let busy = false;
  /** @type {Array<{n:number, c:string}>} most-recent first */
  const history = [];
  /** @type {{n:number,c:string,breakdown:any[]}|null} */
  let lastSpin = null;

  // Refs
  const root = h('div.flex.flex-col.gap-4', {}, []);

  const redraw = () => mount(root, view());

  // ---------- bet helpers ----------
  const addBet = (type, value) => {
    if (busy) return;
    const amount = chip;
    if (amount <= 0) return;
    if (amount > (userStore.get().profile?.credits ?? 0) - currentWager()) {
      return toastError('Not enough credits for that chip');
    }
    // merge with same bet
    const existing = bets.find((b) => b.type === type && String(b.value) === String(value));
    if (existing) existing.amount += amount;
    else bets.push({ type, value, amount, id: cryptoId() });
    redraw();
  };

  const removeBet = (id) => {
    bets = bets.filter((b) => b.id !== id);
    redraw();
  };

  const clearBets = () => { bets = []; redraw(); };

  const repeatLast = () => {
    if (!lastBets.length) return;
    bets = lastBets.map((b) => ({ ...b, id: cryptoId() }));
    redraw();
  };

  const currentWager = () => bets.reduce((s, b) => s + b.amount, 0);

  // ---------- spin ----------
  async function spin() {
    if (busy) return;
    if (!bets.length) return toastError('Place at least one bet');
    const wager = currentWager();
    if (wager > (userStore.get().profile?.credits ?? 0)) {
      return toastError('Not enough credits');
    }

    busy = true;
    redraw();

    try {
      const r = await playRoulette(bets);
      patchProfile({ credits: r.newBalance });

      // Visual spin BEFORE revealing outcome
      await spinWheel(r.roll);

      lastSpin = { n: r.roll, c: r.color, breakdown: r.breakdown ?? [] };
      history.unshift({ n: r.roll, c: r.color });
      if (history.length > 18) history.pop();

      lastBets = bets.map((b) => ({ ...b }));
      bets = [];

      const profit = r.totalPayout - r.totalWager;
      if (profit > 0) {
        toastSuccess(`+${formatCredits(profit)} cr · ${r.roll} ${r.color}`);
        const ratio = r.totalPayout / Math.max(1, r.totalWager);
        // Straight-up number hits land at 36× wager, dozens at 3×, etc.
        if (ratio >= 10)     flashGold({ label: `${r.roll} STRAIGHT UP` });
        else if (ratio >= 3) flashSuccessMajor({ label: `+${formatCredits(profit)}` });
        else                 flashSuccess();
      } else if (r.totalPayout > 0) {
        toastSuccess(`Pushed back ${formatCredits(r.totalPayout)} cr`);
        flashSuccess();
      } else {
        // Total wipe — light sting, the wheel itself already telegraphs it.
        flashLoss();
      }
    } catch (e) {
      toastError(e.message);
    } finally {
      busy = false;
      redraw();
    }
  }

  // The spinning element ref so we can animate it.
  let wheelRef = null;
  let ballRef = null;

  async function spinWheel(targetN) {
    if (!wheelRef || !ballRef) return;
    const idx = WHEEL_ORDER.indexOf(targetN);
    if (idx < 0) return;
    const slotAngle = 360 / WHEEL_ORDER.length;
    // wheel spins one way, ball the other. Both end aligned so the ball
    // sits in the target slot at top.
    const wheelEnd = -(720 + idx * slotAngle); // 2 full turns + offset
    const ballEnd  =  720;                     // 2 full turns the other way
    wheelRef.style.transition = 'transform 3.2s cubic-bezier(0.18, 0.7, 0.2, 1)';
    ballRef.style.transition  = 'transform 3.2s cubic-bezier(0.18, 0.7, 0.2, 1)';
    wheelRef.style.transform = `rotate(${wheelEnd}deg)`;
    ballRef.style.transform  = `rotate(${ballEnd}deg)`;
    await sleep(3300);
  }

  // ---------- view ----------
  function view() {
    return h('div.flex.flex-col.gap-4', {}, [
      h('div.flex.items-end.justify-between.gap-3.flex-wrap', {}, [
        h('div', {}, [
          h('h1.text-2xl.sm:text-3xl.font-semibold.heading-grad', {}, ['Roulette']),
          h('p.text-xs.sm:text-sm.text-muted', {}, [
            'European single-zero. Place chips on numbers, dozens, columns or even-money lines, then spin.',
          ]),
        ]),
        recentStrip(history),
      ]),

      h('div.grid.grid-cols-1.xl:grid-cols-3.gap-4', {}, [
        // LEFT: wheel + result panel (2 cols)
        h('div.xl:col-span-2.flex.flex-col.gap-4', {}, [
          h(
            'div.glass.neon-border.p-3.sm:p-6.flex.flex-col.items-center.gap-4',
            {},
            [
              wheelView((el, b) => { wheelRef = el; ballRef = b; }, lastSpin?.n ?? null),
              resultPanel(lastSpin),
            ]
          ),
          tableView({ bets, addBet, removeBet, lastWinning: lastSpin?.n ?? null }),
        ]),

        // RIGHT: bet slip + controls
        h('div.flex.flex-col.gap-4', {}, [
          chipPicker(chip, (v) => { chip = v; redraw(); }),
          slipPanel(bets, removeBet, currentWager()),
          h('div.grid.grid-cols-2.gap-2', {}, [
            h(
              'button.btn-ghost.h-10',
              { onclick: clearBets, disabled: busy || !bets.length },
              ['Clear']
            ),
            h(
              'button.btn-ghost.h-10',
              { onclick: repeatLast, disabled: busy || !lastBets.length },
              ['Repeat last']
            ),
          ]),
          h(
            'button.btn-primary.h-12.w-full.text-base',
            { onclick: spin, disabled: busy || !bets.length },
            [busy ? 'Spinning…' : `Spin · ${formatCredits(currentWager())} cr`]
          ),
        ]),
      ]),
    ]);
  }

  redraw();
  return appShell(root);
}

// ---------------------------------------------------------------------------
// Wheel
// ---------------------------------------------------------------------------

function wheelView(captureRefs, lastN) {
  const slotAngle = 360 / WHEEL_ORDER.length;

  // Build slice nodes around the wheel.
  const slices = WHEEL_ORDER.map((n, i) => {
    const c = colorOf(n);
    return h(
      'div.absolute.inset-0.flex.justify-center',
      { style: { transform: `rotate(${i * slotAngle}deg)` } },
      [
        h(
          'div.absolute.top-[2px].w-[28px].h-[58px].rounded-b-full.flex.items-start.justify-center.pt-1.text-[10px].font-bold.font-mono',
          {
            style: {
              background:
                c === 'green' ? 'linear-gradient(180deg,#0d8f4f,#04572d)' :
                c === 'red'   ? 'linear-gradient(180deg,#d72e3a,#7a0c14)' :
                                'linear-gradient(180deg,#1a1a1a,#000)',
              color: '#fff',
              borderLeft: '1px solid rgba(255,255,255,0.08)',
              borderRight: '1px solid rgba(0,0,0,0.5)',
            },
          },
          [String(n)]
        ),
      ]
    );
  });

  const wheel = h(
    'div.absolute.inset-0.rounded-full.overflow-hidden.shadow-glow',
    {
      style: {
        background:
          'radial-gradient(circle at 50% 50%, #1a1a2e 30%, #2d1810 70%, #1a0a05 100%)',
        border: '4px solid #b08040',
        boxShadow: '0 0 40px rgba(255,179,71,0.35), inset 0 0 40px rgba(0,0,0,0.6)',
        transformOrigin: 'center',
        transform: 'rotate(0deg)',
      },
    },
    [
      ...slices,
      // Hub
      h(
        'div.absolute.left-1/2.top-1/2.-translate-x-1/2.-translate-y-1/2.w-16.h-16.rounded-full',
        {
          style: {
            background: 'radial-gradient(circle at 30% 30%, #ffd96b, #8a5a13)',
            boxShadow: '0 0 20px rgba(255,179,71,0.5), inset 0 0 12px rgba(0,0,0,0.3)',
          },
        },
        []
      ),
    ]
  );

  // Ball holder rotates around the rim.
  const ball = h(
    'div.absolute.inset-0.flex.justify-center',
    { style: { transformOrigin: 'center', transform: 'rotate(0deg)' } },
    [
      h(
        'div.absolute.top-[6px].w-3.h-3.rounded-full',
        {
          style: {
            background: 'radial-gradient(circle at 30% 30%, #fff, #b8b8b8)',
            boxShadow:
              '0 0 6px rgba(255,255,255,0.9), 0 1px 2px rgba(0,0,0,0.6)',
          },
        },
        []
      ),
    ]
  );

  // Pointer at top
  const pointer = h(
    'div.absolute.left-1/2.-translate-x-1/2.-top-1.w-0.h-0',
    {
      style: {
        borderLeft: '8px solid transparent',
        borderRight: '8px solid transparent',
        borderTop: '14px solid #ffd96b',
        filter: 'drop-shadow(0 0 4px rgba(255,179,71,0.8))',
      },
    },
    []
  );

  // The wheel sizes responsively: ~13 rem on phones, 18 rem on desktop.
  // Slot numbers (rendered above with absolute positioning in pixels) stay
  // legible on both because the slice math is angle-based, not px-based.
  const container = h(
    'div.relative.w-56.h-56.sm:w-64.sm:h-64.md:w-72.md:h-72',
    {},
    [wheel, ball, pointer]
  );

  // hand the refs back so the page can animate
  queueMicrotask(() => captureRefs(wheel, ball));
  return container;
}

function resultPanel(spin) {
  if (!spin) {
    return h(
      'div.text-muted.text-sm.h-9',
      {},
      ['No spin yet — place your bets and hit Spin.']
    );
  }
  const profit = (spin.breakdown ?? []).reduce(
    (s, b) => s + (b.win ? Number(b.amount) * (Number(b.mult) - 1) : -Number(b.amount)),
    0
  );
  const colorBg =
    spin.c === 'green' ? '#0d8f4f' :
    spin.c === 'red'   ? '#d72e3a' : '#1a1a1a';

  return h('div.flex.items-center.gap-4.h-10', {}, [
    h(
      'div.w-12.h-10.rounded-md.flex.items-center.justify-center.text-lg.font-mono.font-bold.text-white',
      { style: { background: colorBg, boxShadow: 'inset 0 0 6px rgba(0,0,0,0.4)' } },
      [String(spin.n)]
    ),
    h(
      `div.text-xs.uppercase.tracking-widest.${
        spin.c === 'red' ? 'text-accent-rose' : spin.c === 'green' ? 'text-accent-lime' : 'text-white/70'
      }`,
      {},
      [spin.c]
    ),
    h(
      `div.font-mono.${profit > 0 ? 'text-accent-lime' : profit < 0 ? 'text-accent-rose' : 'text-white/70'}`,
      {},
      [profit === 0 ? 'Even' : `${profit > 0 ? '+' : ''}${formatCredits(profit)} cr`]
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Betting table
// ---------------------------------------------------------------------------

function tableView({ bets, addBet, removeBet, lastWinning }) {
  // Numbers grid: top row column-3 (3,6,..,36), middle column-2, bottom column-1.
  const ROWS = [
    [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36], // column 3 → top row
    [2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35], // column 2
    [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34], // column 1
  ];

  const numCell = (n) => {
    const c = colorOf(n);
    const placed = bets
      .filter((b) => b.type === 'number' && Number(b.value) === n)
      .reduce((s, b) => s + b.amount, 0);
    const hit = lastWinning === n;
    return h(
      'button.relative.h-12.text-base.font-mono.font-bold.text-white.transition-transform.hover:scale-105',
      {
        onclick: () => addBet('number', n),
        style: {
          background:
            c === 'green' ? 'linear-gradient(180deg,#0d8f4f,#04572d)' :
            c === 'red'   ? 'linear-gradient(180deg,#d72e3a,#7a0c14)' :
                            'linear-gradient(180deg,#222,#000)',
          border: hit ? '2px solid #ffd96b' : '1px solid rgba(255,255,255,0.06)',
          boxShadow: hit ? '0 0 14px rgba(255,179,71,0.7)' : 'inset 0 0 6px rgba(0,0,0,0.3)',
          borderRadius: 4,
        },
      },
      [
        String(n),
        placed > 0 ? chipMark(placed) : null,
      ]
    );
  };

  const outsideCell = (label, type, value, sub) => {
    const placed = bets
      .filter((b) => b.type === type && String(b.value) === String(value ?? ''))
      .reduce((s, b) => s + b.amount, 0);
    return h(
      'button.relative.h-10.text-xs.font-semibold.uppercase.tracking-widest.text-white.transition-transform.hover:scale-105',
      {
        onclick: () => addBet(type, value ?? ''),
        style: {
          background: 'linear-gradient(180deg, #102612, #0a1c0e)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 4,
        },
      },
      [
        h('div.flex.flex-col.items-center.justify-center.leading-tight', {}, [
          h('span', {}, [label]),
          sub ? h('span.text-[9px].text-muted.normal-case.tracking-normal', {}, [sub]) : null,
        ]),
        placed > 0 ? chipMark(placed) : null,
      ]
    );
  };

  const colCell = (col) => {
    const placed = bets
      .filter((b) => b.type === 'column' && Number(b.value) === col)
      .reduce((s, b) => s + b.amount, 0);
    return h(
      'button.relative.h-12.text-xs.font-semibold.uppercase.tracking-widest.text-white.transition-transform.hover:scale-105',
      {
        onclick: () => addBet('column', col),
        style: {
          background: 'linear-gradient(180deg, #102612, #0a1c0e)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 4,
        },
      },
      [
        h('div.flex.flex-col.items-center.justify-center.leading-tight', {}, [
          h('span', {}, ['2:1']),
          h('span.text-[9px].text-muted.normal-case.tracking-normal', {}, [`Col ${col}`]),
        ]),
        placed > 0 ? chipMark(placed) : null,
      ]
    );
  };

  // Build grid with explicit columns:
  //   [0 cell spanning 3 rows] [12 number cells] [column cell]
  // The 14-column layout doesn't fit a phone width, so we put the whole
  // table in a horizontally-scrollable wrapper and give the inner grid a
  // sensible min-width so columns stay legible. Touch users swipe; mouse
  // users on a small window get a normal scrollbar.
  const grid = h(
    'div.gap-1.p-3.glass.neon-border',
    {
      style: {
        display: 'grid',
        gridTemplateColumns: '46px repeat(12, minmax(36px, 1fr)) 56px',
        gridTemplateRows: 'repeat(3, auto)',
        minWidth: '640px',
      },
    },
    [
      // Zero
      h(
        'button.relative.text-base.font-mono.font-bold.text-white.transition-transform.hover:scale-105',
        {
          onclick: () => addBet('number', 0),
          style: {
            gridColumn: '1 / span 1',
            gridRow: '1 / span 3',
            background: 'linear-gradient(180deg,#0d8f4f,#04572d)',
            border: lastWinning === 0 ? '2px solid #ffd96b' : '1px solid rgba(255,255,255,0.08)',
            boxShadow: lastWinning === 0 ? '0 0 14px rgba(255,179,71,0.7)' : 'inset 0 0 6px rgba(0,0,0,0.3)',
            borderRadius: 4,
          },
        },
        [
          '0',
          (() => {
            const placed = bets
              .filter((b) => b.type === 'number' && Number(b.value) === 0)
              .reduce((s, b) => s + b.amount, 0);
            return placed > 0 ? chipMark(placed) : null;
          })(),
        ]
      ),
      ...ROWS[0].map((n) => numCell(n)),
      colCell(3),
      ...ROWS[1].map((n) => numCell(n)),
      colCell(2),
      ...ROWS[2].map((n) => numCell(n)),
      colCell(1),
    ]
  );

  // Outside bets: dozens row, then even-money row. Both rows share the
  // same min-width as the grid above so they line up under it inside the
  // horizontal scroller.
  const dozensRow = h('div.flex.gap-1.px-3', { style: { minWidth: '640px' } }, [
    h('div.w-[46px].shrink-0', {}, []),
    h('div.flex-1', {}, [outsideCell('1st 12', 'dozen', 1, 'Pays 2:1')]),
    h('div.flex-1', {}, [outsideCell('2nd 12', 'dozen', 2, 'Pays 2:1')]),
    h('div.flex-1', {}, [outsideCell('3rd 12', 'dozen', 3, 'Pays 2:1')]),
    h('div.w-[56px].shrink-0', {}, []),
  ]);
  const evensRow = h('div.flex.gap-1.px-3.pb-3', { style: { minWidth: '640px' } }, [
    h('div.w-[46px].shrink-0', {}, []),
    h('div.flex-1', {}, [outsideCell('1–18', 'low', '', 'Pays 1:1')]),
    h('div.flex-1', {}, [outsideCell('Even', 'even', '', 'Pays 1:1')]),
    h('div.flex-1', {}, [outsideCell('Red', 'red', '', 'Pays 1:1')]),
    h('div.flex-1', {}, [outsideCell('Black', 'black', '', 'Pays 1:1')]),
    h('div.flex-1', {}, [outsideCell('Odd', 'odd', '', 'Pays 1:1')]),
    h('div.flex-1', {}, [outsideCell('19–36', 'high', '', 'Pays 1:1')]),
    h('div.w-[56px].shrink-0', {}, []),
  ]);

  return h(
    'div.overflow-x-auto.-mx-2.sm:mx-0.pb-1',
    { style: { WebkitOverflowScrolling: 'touch' } },
    [h('div.flex.flex-col.gap-1.min-w-max', {}, [grid, dozensRow, evensRow])]
  );
}

function chipMark(amount) {
  return h(
    'span.absolute.right-1.top-1.bg-accent-amber.text-[#0a0a0a].text-[9px].font-bold.font-mono.rounded-full.px-1.5.py-0.5.shadow',
    { style: { boxShadow: '0 0 6px rgba(255,179,71,0.6)' } },
    [formatCredits(amount)]
  );
}

// ---------------------------------------------------------------------------
// Side panel
// ---------------------------------------------------------------------------

function chipPicker(current, onPick) {
  return h('div.glass.neon-border.p-4.flex.flex-col.gap-3', {}, [
    h('h3.text-sm.text-muted.uppercase.tracking-widest', {}, ['Chip']),
    h(
      'div.grid.grid-cols-5.gap-2',
      {},
      CHIP_VALUES.map((v) => {
        const sel = v === current;
        return h(
          'button.relative.h-12.rounded-full.text-xs.font-bold.font-mono.text-white.transition-transform.hover:scale-105',
          {
            onclick: () => onPick(v),
            style: {
              background: chipGradient(v),
              border: sel ? '2px solid #22e1ff' : '2px dashed rgba(255,255,255,0.25)',
              boxShadow: sel ? '0 0 12px rgba(34,225,255,0.6)' : 'inset 0 0 6px rgba(0,0,0,0.3)',
            },
          },
          [String(v)]
        );
      })
    ),
  ]);
}

function chipGradient(v) {
  if (v >= 500) return 'radial-gradient(circle at 30% 30%, #b86bff, #4a1380)';
  if (v >= 100) return 'radial-gradient(circle at 30% 30%, #1a1a1a, #000)';
  if (v >= 25)  return 'radial-gradient(circle at 30% 30%, #3ddc7e, #0c5a2e)';
  if (v >= 5)   return 'radial-gradient(circle at 30% 30%, #ff3b6b, #7a0c2a)';
  return                'radial-gradient(circle at 30% 30%, #7ad9ff, #0d4060)';
}

function slipPanel(bets, removeBet, totalWager) {
  return h('div.glass.neon-border.p-4.flex.flex-col.gap-2', {}, [
    h('div.flex.items-center.justify-between', {}, [
      h('h3.text-sm.text-muted.uppercase.tracking-widest', {}, ['Bet slip']),
      h('span.text-xs.text-muted.font-mono', {}, [
        `${bets.length} ${bets.length === 1 ? 'bet' : 'bets'} · ${formatCredits(totalWager)} cr`,
      ]),
    ]),
    bets.length === 0
      ? h('div.text-xs.text-muted.py-4.text-center', {}, ['Click the table to place chips.'])
      : h(
          'div.flex.flex-col.gap-1.max-h-60.overflow-auto',
          {},
          bets.map((b) =>
            h('div.flex.items-center.justify-between.text-xs.glass.p-2', {}, [
              h('div.flex.flex-col.leading-tight', {}, [
                h('span.font-mono.text-white', {}, [betLabel(b)]),
                h('span.text-[10px].text-muted', {}, [`pays ${betPayout(b)}×`]),
              ]),
              h('div.flex.items-center.gap-2', {}, [
                h('span.font-mono.text-accent-cyan', {}, [`${formatCredits(b.amount)}`]),
                h(
                  'button.text-muted.hover:text-accent-rose.text-base.leading-none',
                  { onclick: () => removeBet(b.id) },
                  ['×']
                ),
              ]),
            ])
          )
        ),
  ]);
}

function betLabel(b) {
  switch (b.type) {
    case 'number': return `Number ${b.value}`;
    case 'red':    return 'Red';
    case 'black':  return 'Black';
    case 'even':   return 'Even';
    case 'odd':    return 'Odd';
    case 'low':    return '1–18';
    case 'high':   return '19–36';
    case 'dozen':  return `${ord(Number(b.value))} 12`;
    case 'column': return `Column ${b.value}`;
    default:       return b.type;
  }
}

function betPayout(b) {
  switch (b.type) {
    case 'number': return 36;
    case 'dozen':
    case 'column': return 3;
    default: return 2;
  }
}

function ord(n) { return n === 1 ? '1st' : n === 2 ? '2nd' : '3rd'; }

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

function recentStrip(history) {
  if (!history.length) return null;
  return h(
    'div.flex.items-center.gap-1.flex-wrap.justify-end.max-w-[60%]',
    {},
    [
      h('span.text-[10px].text-muted.uppercase.tracking-widest.mr-1', {}, ['Recent']),
      ...history.slice(0, 14).map(({ n, c }) =>
        h(
          'span.w-7.h-7.rounded-md.flex.items-center.justify-center.text-xs.font-mono.font-bold.text-white',
          {
            style: {
              background:
                c === 'green' ? '#0d8f4f' :
                c === 'red'   ? '#d72e3a' : '#1a1a1a',
              border: '1px solid rgba(255,255,255,0.08)',
            },
          },
          [String(n)]
        )
      ),
    ]
  );
}

function cryptoId() {
  return (crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
