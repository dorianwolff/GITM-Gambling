/**
 * blackjack-page.js
 * Single-shot blackjack: pick a stand-at threshold, see both hands resolve.
 * Server is authoritative; the page just animates the reveal.
 */
import { h, mount } from '../../utils/dom.js';
import { appShell } from '../../ui/layout/app-shell.js';
import { createBetInput } from '../../ui/components/bet-input.js';
import { playBlackjack, cardLabel } from '../../games/blackjack/blackjack-api.js';
import { userStore, patchProfile } from '../../state/user-store.js';
import { toastError, toastSuccess } from '../../ui/components/toast.js';
import { validateBet } from '../../utils/validation.js';
import { formatCredits } from '../../utils/format.js';

export function renderBlackjack() {
  let standAt = 17;
  const bet = createBetInput({ value: 25 });

  const playerHand = h('div.flex.gap-2.flex-wrap.min-h-24', {}, []);
  const dealerHand = h('div.flex.gap-2.flex-wrap.min-h-24', {}, []);
  const playerTotal = h('span.font-mono.text-2xl', {}, ['—']);
  const dealerTotal = h('span.font-mono.text-2xl', {}, ['—']);
  const outcome = h('div.text-2xl.h-9.font-mono', {}, []);

  const standButtons = [12, 13, 14, 15, 16, 17, 18, 19, 20].map((n) =>
    h(
      `button.btn.h-9.text-xs.${standAt === n ? 'btn-primary' : 'btn-ghost'}`,
      {
        onclick: () => {
          standAt = n;
          standButtons.forEach((b, i) => {
            const v = [12, 13, 14, 15, 16, 17, 18, 19, 20][i];
            b.className = (v === standAt ? 'btn-primary' : 'btn-ghost') + ' btn h-9 text-xs';
          });
        },
      },
      [String(n)]
    )
  );

  const dealBtn = h(
    'button.btn-primary.h-12.w-full.text-base',
    {
      onclick: async () => {
        const amount = bet.get();
        const err = validateBet(amount, userStore.get().profile?.credits);
        if (err) return toastError(err);

        dealBtn.disabled = true;
        outcome.textContent = '';
        outcome.className = 'text-2xl h-9 font-mono';

        try {
          const r = await playBlackjack(amount, standAt);
          patchProfile({ credits: r.newBalance });
          await animateDeal(playerHand, r.playerHand);
          playerTotal.textContent = String(r.playerTotal);
          await animateDeal(dealerHand, r.dealerHand);
          dealerTotal.textContent = String(r.dealerTotal);

          const map = {
            blackjack: ['Blackjack! +' + formatCredits(r.payout - amount), 'text-accent-lime'],
            win: ['Win +' + formatCredits(r.payout - amount), 'text-accent-lime'],
            push: ['Push', 'text-white/70'],
            lose: ['Lose', 'text-accent-rose'],
            bust: ['Bust', 'text-accent-rose'],
          };
          const [txt, cls] = map[r.outcome] ?? ['—', ''];
          outcome.textContent = txt;
          outcome.className = `text-2xl h-9 font-mono ${cls}`;
          if (r.payout > amount) toastSuccess(`+${formatCredits(r.payout - amount)} cr`);
        } catch (e) {
          toastError(e.message);
        } finally {
          dealBtn.disabled = false;
        }
      },
    },
    ['Deal']
  );

  return appShell(
    h('div.flex.flex-col.gap-4', {}, [
      h('h1.text-3xl.font-semibold.heading-grad', {}, ['Blackjack']),
      h('p.text-sm.text-muted', {}, [
        'Pre-commit your "stand at" total. Dealer hits to 17. Blackjack pays 2.5×.',
      ]),
      h('div.grid.grid-cols-1.lg:grid-cols-3.gap-4', {}, [
        h('div.lg:col-span-2.glass.neon-border.p-6.flex.flex-col.gap-5', {}, [
          row('Dealer', dealerHand, dealerTotal),
          h('div.h-px.bg-white/5', {}, []),
          row('You', playerHand, playerTotal),
          outcome,
        ]),
        h('div.glass.neon-border.p-6.flex.flex-col.gap-4', {}, [
          h('div.flex.flex-col.gap-2', {}, [
            h('label.text-xs.text-muted.uppercase.tracking-widest', {}, [
              'Stand at total',
            ]),
            h('div.flex.flex-wrap.gap-1', {}, standButtons),
          ]),
          bet.el,
          dealBtn,
        ]),
      ]),
    ])
  );
}

function row(name, handEl, totalEl) {
  return h('div.flex.flex-col.gap-2', {}, [
    h('div.flex.items-center.justify-between', {}, [
      h('span.text-xs.text-muted.uppercase.tracking-widest', {}, [name]),
      h('div.flex.items-baseline.gap-1', {}, [
        totalEl,
        h('span.text-[10px].text-muted', {}, ['total']),
      ]),
    ]),
    handEl,
  ]);
}

async function animateDeal(container, hand) {
  mount(container, h('div', {}, []));
  for (const v of hand) {
    container.appendChild(card(v));
    await new Promise((r) => setTimeout(r, 220));
  }
}

function card(v) {
  const isAce = v === 1;
  const isFace = v === 10;
  const c = h(
    'div.w-16.h-24.rounded-xl.border.border-white/15.flex.items-center.justify-center.text-2xl.font-mono.font-bold.shadow-card.bg-white/[0.04]',
    {
      style: {
        backgroundImage:
          'linear-gradient(135deg, rgba(34,225,255,0.08), rgba(139,92,246,0.08))',
      },
    },
    [
      h(`span.${isAce ? 'text-accent-amber' : isFace ? 'text-accent-cyan' : ''}`, {}, [
        cardLabel(v),
      ]),
    ]
  );
  c.animate(
    [
      { transform: 'translateY(-12px) rotate(-6deg)', opacity: 0 },
      { transform: 'translateY(0) rotate(0)', opacity: 1 },
    ],
    { duration: 250, easing: 'ease-out' }
  );
  return c;
}
