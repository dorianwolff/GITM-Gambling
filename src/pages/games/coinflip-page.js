/**
 * coinflip-page.js
 * Pick a side, watch the coin, see the result. Server is authoritative.
 */
import { h, mount } from '../../utils/dom.js';
import { appShell } from '../../ui/layout/app-shell.js';
import { createBetInput } from '../../ui/components/bet-input.js';
import { playCoinflip } from '../../games/coinflip/coinflip-api.js';
import { userStore, patchProfile } from '../../state/user-store.js';
import { toastError, toastSuccess } from '../../ui/components/toast.js';
import { validateBet } from '../../utils/validation.js';
import { formatCredits } from '../../utils/format.js';

export function renderCoinflip() {
  let side = 'heads';
  const bet = createBetInput({ value: 10 });

  const coin = h(
    'div.relative.w-48.h-48.rounded-full.shadow-glow.transition-transform.duration-700',
    {
      style: {
        background:
          'conic-gradient(from 0deg, #ffd96b, #b8860b, #ffd96b, #b8860b, #ffd96b)',
        boxShadow:
          'inset 0 0 30px rgba(0,0,0,0.4), 0 0 60px rgba(255,179,71,0.4)',
        transformStyle: 'preserve-3d',
      },
    },
    [
      h(
        'div.absolute.inset-2.rounded-full.flex.items-center.justify-center.text-6xl.font-bold.text-amber-900',
        { style: { background: 'radial-gradient(circle at 30% 30%, #ffe58a, #c08a13)' } },
        ['H']
      ),
    ]
  );

  const resultEl = h('div.text-2xl.h-8.font-mono', {}, ['']);
  const log = h('div.flex.flex-col.gap-1.text-xs.text-muted.font-mono.max-h-40.overflow-auto', {}, []);

  const sideBtn = (s) =>
    h(
      `button.btn.h-12.flex-1.${side === s ? 'btn-primary' : 'btn-ghost'}.text-base`,
      {
        onclick: () => {
          side = s;
          headsBtn.className =
            (side === 'heads' ? 'btn-primary' : 'btn-ghost') + ' btn h-12 flex-1 text-base';
          tailsBtn.className =
            (side === 'tails' ? 'btn-primary' : 'btn-ghost') + ' btn h-12 flex-1 text-base';
        },
      },
      [s === 'heads' ? '⬢ Heads' : '⬣ Tails']
    );
  const headsBtn = sideBtn('heads');
  const tailsBtn = sideBtn('tails');

  const flipBtn = h(
    'button.btn-primary.h-12.w-full.text-base',
    {
      onclick: async () => {
        const amount = bet.get();
        const err = validateBet(amount, userStore.get().profile?.credits);
        if (err) return toastError(err);

        flipBtn.disabled = true;
        resultEl.textContent = '';

        // Spin: flip the visible face every 90ms so the coin actually
        // looks like it has two sides while rotating.
        const face = coin.firstElementChild;
        const swap = setInterval(() => {
          face.textContent = face.textContent === 'H' ? 'T' : 'H';
        }, 90);
        coin.style.transform = `rotateY(${1080 + Math.random() * 720}deg)`;

        try {
          const r = await playCoinflip(amount, side);
          patchProfile({ credits: r.newBalance });

          await new Promise((res) => setTimeout(res, 700));
          clearInterval(swap);
          face.textContent = r.result === 'heads' ? 'H' : 'T';
          coin.style.transform = `rotateY(${r.result === side ? 1080 : 1260}deg)`;

          if (r.won) {
            resultEl.textContent = `+${formatCredits(r.payout)} cr · ${r.result.toUpperCase()}`;
            resultEl.className = 'text-2xl h-8 font-mono text-accent-lime';
            toastSuccess(`Won ${formatCredits(r.payout)} cr`);
          } else {
            resultEl.textContent = `Lost · ${r.result.toUpperCase()}`;
            resultEl.className = 'text-2xl h-8 font-mono text-accent-rose';
          }

          log.prepend(
            h(
              `div.${r.won ? 'text-accent-lime' : 'text-accent-rose'}`,
              {},
              [
                `${new Date().toLocaleTimeString()} · ${side} → ${r.result} · ${r.won ? '+' + r.payout : '-' + amount}`,
              ]
            )
          );
        } catch (e) {
          toastError(e.message);
        } finally {
          flipBtn.disabled = false;
        }
      },
    },
    ['Flip']
  );

  const layout = h('div.grid.grid-cols-1.lg:grid-cols-2.gap-6', {}, [
    h('div.glass.neon-border.p-8.flex.flex-col.items-center.gap-6', {}, [
      coin,
      resultEl,
    ]),
    h('div.glass.neon-border.p-6.flex.flex-col.gap-5', {}, [
      h('h2.text-xl.font-semibold', {}, ['Place your bet']),
      h('div.flex.gap-2', {}, [headsBtn, tailsBtn]),
      bet.el,
      flipBtn,
      h('div.text-xs.text-muted', {}, ['Payout 1.95× · House edge 2.5%']),
      h('h3.text-xs.text-muted.uppercase.tracking-widest.mt-2', {}, ['Your flips']),
      log,
    ]),
  ]);

  return appShell(
    h('div.flex.flex-col.gap-4', {}, [
      h('h1.text-3xl.font-semibold.heading-grad', {}, ['Coinflip']),
      layout,
    ])
  );
}
