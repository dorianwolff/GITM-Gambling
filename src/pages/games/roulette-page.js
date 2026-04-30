/**
 * roulette-page.js
 * European single-zero roulette. Stack chips on color/parity/range/dozen/column
 * or single numbers, then spin. Server-resolved.
 */
import { h, mount } from '../../utils/dom.js';
import { appShell } from '../../ui/layout/app-shell.js';
import { playRoulette, colorOf, WHEEL_ORDER, RED_NUMBERS } from '../../games/roulette/roulette-api.js';
import { userStore, patchProfile } from '../../state/user-store.js';
import { toastError, toastSuccess } from '../../ui/components/toast.js';
import { formatCredits } from '../../utils/format.js';

export function renderRoulette() {
  /** @type {Array<{type:string,value:string|number,amount:number,label:string}>} */
  let bets = [];
  let chipSize = 5;

  const totalEl = h('span.font-mono.text-accent-cyan', {}, ['0']);
  const betsList = h('div.flex.flex-col.gap-1.max-h-40.overflow-auto.text-xs', {}, []);

  const refreshBets = () => {
    const tot = bets.reduce((s, b) => s + b.amount, 0);
    totalEl.textContent = formatCredits(tot);
    mount(
      betsList,
      bets.length === 0
        ? h('div.text-muted', {}, ['No chips placed yet.'])
        : h(
            'div.flex.flex-col.gap-1',
            {},
            bets.map((b, i) =>
              h('div.flex.items-center.justify-between.gap-2', {}, [
                h('span.text-white/80', {}, [b.label]),
                h('span.font-mono.text-accent-cyan', {}, [`${formatCredits(b.amount)} cr`]),
                h(
                  'button.text-accent-rose.text-xs',
                  {
                    onclick: () => {
                      bets.splice(i, 1);
                      refreshBets();
                    },
                  },
                  ['×']
                ),
              ])
            )
          )
    );
  };

  const addBet = (type, value, label) => {
    if (chipSize < 1) return;
    const existing = bets.find((b) => b.type === type && String(b.value) === String(value));
    if (existing) existing.amount += chipSize;
    else bets.push({ type, value, amount: chipSize, label });
    refreshBets();
  };

  // Number grid
  const grid = h('div.grid.grid-cols-13.gap-1', {}, []);
  // 0
  grid.appendChild(numberCell(0, addBet));
  // 1..36 in 3 rows
  for (let row = 2; row >= 0; row--) {
    for (let col = 0; col < 12; col++) {
      const n = row + 1 + col * 3;
      grid.appendChild(numberCell(n, addBet));
    }
  }
  grid.style.gridTemplateColumns = '40px repeat(12, minmax(0,1fr))';

  // outside bets
  const outside = h('div.grid.grid-cols-2.md:grid-cols-3.gap-2', {}, [
    chipBtn('Red', () => addBet('red', '', 'Red'), 'bg-accent-rose/30'),
    chipBtn('Black', () => addBet('black', '', 'Black'), 'bg-black/40'),
    chipBtn('Even', () => addBet('even', '', 'Even')),
    chipBtn('Odd', () => addBet('odd', '', 'Odd')),
    chipBtn('1–18', () => addBet('low', '', '1–18')),
    chipBtn('19–36', () => addBet('high', '', '19–36')),
    chipBtn('1st 12', () => addBet('dozen', 1, '1st dozen')),
    chipBtn('2nd 12', () => addBet('dozen', 2, '2nd dozen')),
    chipBtn('3rd 12', () => addBet('dozen', 3, '3rd dozen')),
  ]);

  const chips = [1, 5, 25, 100, 500].map((v) =>
    h(
      'button.btn.btn-ghost.h-9.text-xs.font-mono',
      {
        onclick: () => {
          chipSize = v;
          chipsRow
            .querySelectorAll('button')
            .forEach((b) =>
              (b.className = (Number(b.textContent) === v ? 'btn-primary' : 'btn-ghost') + ' btn h-9 text-xs font-mono')
            );
        },
      },
      [String(v)]
    )
  );
  const chipsRow = h('div.flex.gap-1', {}, chips);
  chips[1].className = 'btn-primary btn h-9 text-xs font-mono'; // default 5

  const wheelEl = h(
    'div.relative.w-56.h-56.rounded-full.border.border-white/10.flex.items-center.justify-center.shadow-glow',
    { style: { background: 'conic-gradient(from 0deg, #0e1120, #1a1f3a, #0e1120)' } },
    [
      h(
        'div.absolute.inset-2.rounded-full.flex.items-center.justify-center.text-5xl.font-mono.font-bold',
        { style: { background: 'radial-gradient(circle at 30% 30%, #11142450, #0a0c16)' } },
        ['—']
      ),
    ]
  );
  const wheelText = wheelEl.firstElementChild;

  const spinBtn = h(
    'button.btn-primary.h-12.w-full.text-base',
    {
      onclick: async () => {
        if (bets.length === 0) return toastError('Place at least one chip');
        const tot = bets.reduce((s, b) => s + b.amount, 0);
        if (tot > (userStore.get().profile?.credits ?? 0))
          return toastError('Not enough credits');

        spinBtn.disabled = true;
        wheelEl.style.transition = 'transform 2.5s cubic-bezier(0.2, 0.7, 0.2, 1)';
        wheelEl.style.transform = `rotate(${1080 + Math.random() * 720}deg)`;

        try {
          const r = await playRoulette(bets);
          patchProfile({ credits: r.newBalance });
          await new Promise((res) => setTimeout(res, 2400));

          wheelText.textContent = String(r.roll);
          wheelText.style.color =
            r.color === 'red' ? '#ff4d6d' : r.color === 'green' ? '#a3ff3c' : '#ffffff';

          const net = r.totalPayout - r.totalWager;
          if (net > 0) toastSuccess(`+${formatCredits(net)} cr · ${r.roll} ${r.color}`);
          else toastError(`${r.roll} ${r.color} · -${formatCredits(-net)}`);

          bets = [];
          refreshBets();
        } catch (e) {
          toastError(e.message);
        } finally {
          spinBtn.disabled = false;
        }
      },
    },
    ['Spin']
  );

  const clearBtn = h(
    'button.btn-ghost.h-10.text-xs',
    {
      onclick: () => {
        bets = [];
        refreshBets();
      },
    },
    ['Clear']
  );

  refreshBets();

  return appShell(
    h('div.flex.flex-col.gap-4', {}, [
      h('h1.text-3xl.font-semibold.heading-grad', {}, ['Roulette']),
      h('div.grid.grid-cols-1.xl:grid-cols-3.gap-6', {}, [
        h('div.xl:col-span-2.flex.flex-col.gap-3', {}, [
          h('div.glass.neon-border.p-4.overflow-auto', {}, [grid]),
          outside,
        ]),
        h('div.flex.flex-col.gap-3', {}, [
          h('div.glass.neon-border.p-6.flex.flex-col.items-center.gap-4', {}, [wheelEl]),
          h('div.glass.neon-border.p-4.flex.flex-col.gap-3', {}, [
            h('div.flex.items-center.justify-between', {}, [
              h('span.text-xs.text-muted.uppercase.tracking-widest', {}, ['Chip size']),
              chipsRow,
            ]),
            h('div.flex.items-center.justify-between', {}, [
              h('span.text-xs.text-muted.uppercase.tracking-widest', {}, ['Total wager']),
              totalEl,
            ]),
            betsList,
            h('div.flex.gap-2', {}, [clearBtn, spinBtn]),
          ]),
        ]),
      ]),
    ])
  );
}

function numberCell(n, addBet) {
  const c = colorOf(n);
  const bg =
    c === 'red'
      ? 'bg-accent-rose/30 hover:bg-accent-rose/50'
      : c === 'black'
        ? 'bg-black/40 hover:bg-black/60'
        : 'bg-accent-lime/30 hover:bg-accent-lime/50';
  return h(
    `button.h-10.rounded-md.border.border-white/10.font-mono.text-sm.${bg}.transition`,
    { onclick: () => addBet('number', n, '#' + n) },
    [String(n)]
  );
}

function chipBtn(label, onclick, extra = '') {
  return h(`button.btn-ghost.h-10.text-sm.${extra}`, { onclick }, [label]);
}
