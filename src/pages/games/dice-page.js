/**
 * dice-page.js
 * Slider-controlled dice with live multiplier and win-chance preview.
 */
import { h } from '../../utils/dom.js';
import { appShell } from '../../ui/layout/app-shell.js';
import { createBetInput } from '../../ui/components/bet-input.js';
import { playDice, expectedMultiplier } from '../../games/dice/dice-api.js';
import { userStore, patchProfile } from '../../state/user-store.js';
import { toastError } from '../../ui/components/toast.js';
import { validateBet } from '../../utils/validation.js';
import { formatMultiplier, formatPct, formatCredits } from '../../utils/format.js';

export function renderDice() {
  let target = 50;
  let over = true;
  const bet = createBetInput({ value: 10 });

  const slider = h('input.w-full', {
    type: 'range',
    min: '4',
    max: '96',
    value: String(target),
    style: { accentColor: '#22e1ff' },
  });

  const multEl = h('span.text-3xl.font-mono.text-accent-cyan', {}, []);
  const chanceEl = h('span.text-sm.text-muted', {}, []);
  const targetEl = h('span.text-2xl.font-mono', {}, []);
  const rollEl = h(
    'div.text-7xl.font-mono.font-bold.h-24.flex.items-center.justify-center.transition-colors',
    {},
    ['—']
  );

  const overBtn = h(
    'button.btn.flex-1.h-10.btn-ghost',
    { onclick: () => { over = true; updateModeButtons(); refresh(); } },
    ['Over']
  );
  const underBtn = h(
    'button.btn.flex-1.h-10.btn-ghost',
    { onclick: () => { over = false; updateModeButtons(); refresh(); } },
    ['Under']
  );
  function updateModeButtons() {
    overBtn.className = (over ? 'btn-primary' : 'btn-ghost') + ' btn flex-1 h-10';
    underBtn.className = (!over ? 'btn-primary' : 'btn-ghost') + ' btn flex-1 h-10';
  }
  updateModeButtons();

  const refresh = () => {
    const winChance = over ? (100 - target) / 100 : (target - 1) / 100;
    multEl.textContent = formatMultiplier(expectedMultiplier(target, over));
    chanceEl.textContent = `Win chance ${formatPct(winChance)}`;
    targetEl.textContent = `${over ? '>' : '<'} ${target}`;
  };

  slider.addEventListener('input', () => {
    target = Number(slider.value);
    refresh();
  });
  refresh();

  const rollBtn = h(
    'button.btn-primary.h-12.w-full.text-base',
    {
      onclick: async () => {
        const amount = bet.get();
        const err = validateBet(amount, userStore.get().profile?.credits);
        if (err) return toastError(err);

        rollBtn.disabled = true;
        rollEl.textContent = '…';
        rollEl.className =
          'text-7xl font-mono font-bold h-24 flex items-center justify-center text-white/50';

        try {
          const r = await playDice(amount, target, over);
          patchProfile({ credits: r.newBalance });
          rollEl.textContent = String(r.roll);
          rollEl.className =
            'text-7xl font-mono font-bold h-24 flex items-center justify-center ' +
            (r.won ? 'text-accent-lime' : 'text-accent-rose');
          if (r.won) {
            rollEl.animate(
              [{ transform: 'scale(0.8)' }, { transform: 'scale(1.15)' }, { transform: 'scale(1)' }],
              { duration: 500 }
            );
          }
        } catch (e) {
          toastError(e.message);
          rollEl.textContent = '—';
        } finally {
          rollBtn.disabled = false;
        }
      },
    },
    ['Roll']
  );

  const left = h('div.glass.neon-border.p-8.flex.flex-col.items-center.gap-6', {}, [
    h('div.text-xs.text-muted.uppercase.tracking-widest', {}, ['Roll']),
    rollEl,
    h('div.flex.items-center.gap-3', {}, [
      h('span.text-xs.text-muted.uppercase.tracking-widest', {}, ['Target']),
      targetEl,
    ]),
    h('div.flex.items-center.gap-6', {}, [
      h('div.flex.flex-col.items-center', {}, [
        multEl,
        h('span.text-[10px].text-muted.uppercase.tracking-widest', {}, ['Multiplier']),
      ]),
      h('div.flex.flex-col.items-center', {}, [
        chanceEl,
        h('span.text-[10px].text-muted.uppercase.tracking-widest', {}, ['Win chance']),
      ]),
    ]),
  ]);

  const right = h('div.glass.neon-border.p-6.flex.flex-col.gap-5', {}, [
    h('div.flex.gap-2', {}, [overBtn, underBtn]),
    h('div.flex.flex-col.gap-2', {}, [
      h('label.text-xs.text-muted.uppercase.tracking-widest', {}, ['Target (4–96)']),
      slider,
      h('div.flex.justify-between.text-xs.text-muted.font-mono', {}, [
        h('span', {}, ['4']),
        h('span', {}, ['50']),
        h('span', {}, ['96']),
      ]),
    ]),
    bet.el,
    rollBtn,
    h('div.text-xs.text-muted', {}, ['House edge 3% · Server-side RNG']),
  ]);

  return appShell(
    h('div.flex.flex-col.gap-4', {}, [
      h('h1.text-3xl.font-semibold.heading-grad', {}, ['Dice']),
      h('div.grid.grid-cols-1.lg:grid-cols-2.gap-6', {}, [left, right]),
    ])
  );
}
