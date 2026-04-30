/**
 * blackjack-page.js
 * Interactive blackjack — full Hit / Stand / Double / Split / Surrender /
 * Insurance flow. The page is a thin shell over the server state returned
 * by every RPC: each action returns the updated `blackjack_hands` row, we
 * stash it in `state` and re-render.
 */
import { h, mount } from '../../utils/dom.js';
import { appShell } from '../../ui/layout/app-shell.js';
import { createBetInput } from '../../ui/components/bet-input.js';
import {
  bjStart, bjHit, bjStand, bjDouble, bjSplit, bjSurrender, bjInsurance,
} from '../../games/blackjack/blackjack-api.js';
import { userStore } from '../../state/user-store.js';
import { toastError, toastSuccess } from '../../ui/components/toast.js';
import { validateBet } from '../../utils/validation.js';
import { formatCredits } from '../../utils/format.js';
import {
  SUITS, rankOf, suitOf, rankLabel, handTotal, isSoft,
  isBlackjack, sameRankForSplit,
} from '../../utils/cards.js';

export function renderBlackjack() {
  /** @type {any|null} server-returned blackjack_hands row */
  let state = null;
  let busy = false;

  const root = h('div.flex.flex-col.gap-4', {}, []);
  const bet = createBetInput({ value: 25 });
  const dealBtn = h('button.btn-primary.h-12.w-full.text-base', {}, ['Deal']);

  const action = async (fn) => {
    if (busy) return;
    busy = true;
    try {
      state = await fn();
      redraw();
    } catch (e) {
      toastError(e.message);
    } finally {
      busy = false;
    }
  };

  dealBtn.onclick = async () => {
    const amount = bet.get();
    const err = validateBet(amount, userStore.get().profile?.credits);
    if (err) return toastError(err);
    await action(() => bjStart(amount));
  };

  const redraw = () => mount(root, view());

  function view() {
    const hands = state?.hands ?? [];
    const dealer = state?.dealer_cards ?? [];
    const status = state?.status;
    const active = state?.active_hand ?? 0;
    const showHoleCard = status === 'done' || dealerMustReveal(state);

    return h('div.flex.flex-col.gap-5', {}, [
      h('div.flex.items-end.justify-between.gap-3.flex-wrap', {}, [
        h('div.flex.flex-col', {}, [
          h('h1.text-3xl.font-semibold.heading-grad', {}, ['Blackjack']),
          h('p.text-sm.text-muted', {}, [
            'Dealer hits to 17. Blackjack pays 3:2. Insurance pays 2:1.',
          ]),
        ]),
        state
          ? h(
              'div.text-xs.text-muted.font-mono',
              {},
              [
                'Hand id ',
                h('span.text-white/50', {}, [state.id.slice(0, 8)]),
              ]
            )
          : null,
      ]),

      h('div.grid.grid-cols-1.lg:grid-cols-3.gap-4', {}, [
        // Felt area
        h(
          'div.lg:col-span-2.glass.neon-border.p-6.flex.flex-col.gap-6.relative.overflow-hidden',
          {
            style: {
              backgroundImage:
                'radial-gradient(ellipse at top, rgba(34,225,255,0.06), transparent 60%),' +
                'radial-gradient(ellipse at bottom, rgba(139,92,246,0.06), transparent 60%)',
            },
          },
          [
            // Dealer
            handBlock(
              'Dealer',
              dealer.map((c, i) => (i === 1 && !showHoleCard ? null : c)),
              {
                total: showHoleCard ? handTotal(dealer) : dealer[0] != null ? handTotal([dealer[0]]) : null,
                soft:  showHoleCard ? isSoft(dealer) : false,
                hidden: !showHoleCard ? 1 : 0,
              }
            ),

            h('div.h-px.bg-white/5', {}, []),

            // Player hand(s)
            hands.length === 0
              ? h(
                  'div.text-muted.text-center.py-10.text-sm',
                  {},
                  ['Place a bet and click Deal to start.']
                )
              : h(
                  'div.flex.flex-col.gap-4',
                  {},
                  hands.map((hand, idx) =>
                    handBlock(
                      hands.length > 1 ? `Hand ${idx + 1}` : 'You',
                      hand.cards,
                      {
                        total: handTotal(hand.cards),
                        soft:  isSoft(hand.cards),
                        bet:   hand.bet,
                        active: status === 'active' && idx === active && !hand.done,
                        result: hand.result,
                        payout: hand.payout,
                        doubled: hand.doubled,
                        surrendered: hand.surrendered,
                      }
                    )
                  )
                ),

            // Round summary banner
            status === 'done' ? roundSummary(state) : null,
          ]
        ),

        // Side panel
        h('div.glass.neon-border.p-6.flex.flex-col.gap-4', {}, [
          status === 'awaiting_insurance'
            ? insurancePanel(state, action)
            : status === 'active'
              ? actionPanel(state, action)
              : status === 'done'
                ? newHandPanel(bet, dealBtn)
                : newHandPanel(bet, dealBtn),
          legend(),
        ]),
      ]),
    ]);
  }

  redraw();
  return appShell(root);
}

// ---------------------------------------------------------------------------
// View helpers
// ---------------------------------------------------------------------------

function dealerMustReveal(state) {
  if (!state) return false;
  if (state.status !== 'active') return false;
  // All player hands are done (busted or otherwise) ⇒ server hasn't
  // finalized yet but reveal won't hurt. Defensive: keep hidden.
  return false;
}

function handBlock(name, cards, opts = {}) {
  return h('div.flex.flex-col.gap-2', {}, [
    h('div.flex.items-center.justify-between.gap-2', {}, [
      h('div.flex.items-center.gap-2', {}, [
        h(
          `span.text-xs.uppercase.tracking-widest.${opts.active ? 'text-accent-cyan' : 'text-muted'}`,
          {},
          [name, opts.active ? ' · acting' : '']
        ),
        opts.doubled ? chip('Doubled', 'amber') : null,
        opts.surrendered ? chip('Surrendered', 'rose') : null,
        opts.bet != null ? chip(`${formatCredits(opts.bet)} cr`, 'cyan') : null,
      ]),
      opts.total != null
        ? h('div.flex.items-baseline.gap-1', {}, [
            h(
              `span.font-mono.text-2xl.${
                opts.total > 21 ? 'text-accent-rose'
                : opts.total === 21 ? 'text-accent-lime' : ''
              }`,
              {},
              [String(opts.total)]
            ),
            opts.soft ? h('span.text-[10px].text-muted', {}, ['soft']) : null,
            opts.hidden ? h('span.text-[10px].text-muted', {}, ['+ hole']) : null,
          ])
        : null,
    ]),
    h(
      'div.flex.gap-2.flex-wrap.min-h-[112px]',
      { class: opts.active ? 'ring-1 ring-accent-cyan/30 rounded-2xl p-2 -m-2' : '' },
      cards.map((c) => (c == null ? cardBack() : cardFront(c)))
    ),
    opts.result
      ? h(
          `div.text-sm.font-mono.${
            ['win', 'blackjack'].includes(opts.result) ? 'text-accent-lime'
            : opts.result === 'push' ? 'text-white/70'
            : 'text-accent-rose'
          }`,
          {},
          [resultLabel(opts.result, opts.payout, opts.bet)]
        )
      : null,
  ]);
}

function cardFront(card) {
  const r = rankOf(card);
  const suit = suitOf(card);
  const label = rankLabel(card);
  const el = h(
    'div.relative.w-16.h-24.rounded-xl.border.border-black/30.shadow-card.flex.flex-col.justify-between.p-1.5.font-bold',
    {
      style: {
        background:
          'linear-gradient(160deg, #ffffff 0%, #f3f5fb 60%, #e6eaf2 100%)',
        color: suit.color,
        boxShadow: `0 4px 12px rgba(0,0,0,0.4), 0 0 0 1px rgba(0,0,0,0.5), inset 0 0 12px ${suit.glow}`,
      },
    },
    [
      h('div.flex.flex-col.items-start.leading-none', {}, [
        h('span.text-base', { style: { color: suit.color } }, [label]),
        h('span.text-base', { style: { color: suit.color } }, [suit.glyph]),
      ]),
      h(
        'div.absolute.inset-0.flex.items-center.justify-center.pointer-events-none',
        {},
        [
          h('span.text-3xl', { style: { color: suit.color, opacity: 0.85 } }, [
            suit.glyph,
          ]),
        ]
      ),
      h('div.flex.flex-col.items-end.leading-none.rotate-180', {}, [
        h('span.text-base', { style: { color: suit.color } }, [label]),
        h('span.text-base', { style: { color: suit.color } }, [suit.glyph]),
      ]),
    ]
  );
  el.animate(
    [
      { transform: 'translateY(-14px) rotate(-6deg)', opacity: 0 },
      { transform: 'translateY(0) rotate(0)',          opacity: 1 },
    ],
    { duration: 280, easing: 'cubic-bezier(0.2,0.8,0.2,1)' }
  );
  // tag rank for testing / a11y
  el.dataset.rank = String(r);
  el.dataset.suit = suit.name;
  return el;
}

function cardBack() {
  return h(
    'div.w-16.h-24.rounded-xl.border.border-white/10.shadow-card',
    {
      style: {
        background:
          'repeating-linear-gradient(45deg, #1a2040, #1a2040 6px, #2a3070 6px, #2a3070 12px)',
        boxShadow:
          '0 4px 12px rgba(0,0,0,0.4), inset 0 0 12px rgba(34,225,255,0.25)',
      },
    },
    []
  );
}

function chip(text, tone = 'cyan') {
  const map = {
    cyan:  'bg-accent-cyan/15 text-accent-cyan border-accent-cyan/30',
    amber: 'bg-accent-amber/15 text-accent-amber border-accent-amber/30',
    rose:  'bg-accent-rose/15 text-accent-rose border-accent-rose/30',
    lime:  'bg-accent-lime/15 text-accent-lime border-accent-lime/30',
  };
  return h(
    `span.text-[10px].uppercase.tracking-widest.font-semibold.px-2.py-0.5.rounded-full.border.${map[tone]}`,
    {},
    [text]
  );
}

function resultLabel(result, payout, betAmt) {
  const profit = (payout ?? 0) - (betAmt ?? 0);
  switch (result) {
    case 'blackjack': return `Blackjack! +${formatCredits(profit)} cr`;
    case 'win':       return `Win +${formatCredits(profit)} cr`;
    case 'push':      return 'Push (bet returned)';
    case 'lose':      return `Lose -${formatCredits(betAmt ?? 0)} cr`;
    case 'bust':      return `Bust -${formatCredits(betAmt ?? 0)} cr`;
    case 'surrender': return `Surrendered · -${formatCredits((betAmt ?? 0) - (payout ?? 0))} cr`;
    default:          return result;
  }
}

function roundSummary(state) {
  const tot = state.outcome_summary?.total_payout ?? 0;
  const wagered = (state.hands ?? []).reduce((s, h_) => s + (h_.bet ?? 0), 0)
                + (state.insurance_bet ?? 0);
  const net = tot - wagered;
  return h(
    `div.text-center.font-mono.text-lg.py-2.${net > 0 ? 'text-accent-lime' : net < 0 ? 'text-accent-rose' : 'text-white/70'}`,
    {},
    [
      net === 0 ? 'Even round'
        : net > 0 ? `+${formatCredits(net)} credits` : `${formatCredits(net)} credits`,
    ]
  );
}

function actionPanel(state, action) {
  const hand = state.hands[state.active_hand];
  const cards = hand?.cards ?? [];
  const isFresh = cards.length === 2 && !hand.doubled && !hand.surrendered;
  const onlyHand = state.hands.length === 1;
  const canDouble = isFresh;
  const canSplit = isFresh && onlyHand && sameRankForSplit(cards[0], cards[1]);
  const canSurrender = isFresh && onlyHand;

  return h('div.flex.flex-col.gap-2', {}, [
    h('h3.text-sm.text-muted.uppercase.tracking-widest', {}, ['Your move']),
    h('div.grid.grid-cols-2.gap-2', {}, [
      btn('Hit',       () => action(() => bjHit(state.id)),       'btn-primary'),
      btn('Stand',     () => action(() => bjStand(state.id)),     'btn-success'),
      btn('Double',    () => action(() => bjDouble(state.id)),    'btn-ghost', !canDouble),
      btn('Split',     () => action(() => bjSplit(state.id)),     'btn-ghost', !canSplit),
      btn('Surrender', () => action(() => bjSurrender(state.id)), 'btn-danger', !canSurrender),
    ]),
    h(
      'div.text-[11px].text-muted.leading-relaxed.mt-1',
      {},
      [
        'Double: lock 1× more, draw 1 card, end. ',
        'Split: same-rank pairs only, 1× more bet, one card per side. ',
        'Surrender: forfeit half the bet, only on first 2 cards.',
      ]
    ),
  ]);
}

function insurancePanel(state, action) {
  return h('div.flex.flex-col.gap-3', {}, [
    h('h3.text-sm.text-accent-amber.uppercase.tracking-widest', {}, [
      'Dealer shows an Ace',
    ]),
    h('p.text-sm.text-white/70', {}, [
      'Take insurance for half your bet (',
      h('span.font-mono', {}, [formatCredits(Math.floor(state.bet / 2))]),
      ' cr)? Pays 2:1 if the dealer has blackjack.',
    ]),
    h('div.grid.grid-cols-2.gap-2', {}, [
      btn('Take',  () => action(() => bjInsurance(state.id, true)),  'btn-success'),
      btn('Skip',  () => action(() => bjInsurance(state.id, false)), 'btn-ghost'),
    ]),
  ]);
}

function newHandPanel(betCmp, dealBtn) {
  return h('div.flex.flex-col.gap-3', {}, [
    h('h3.text-sm.text-muted.uppercase.tracking-widest', {}, ['New hand']),
    betCmp.el,
    dealBtn,
  ]);
}

function btn(label, onclick, kind = 'btn-ghost', disabled = false) {
  return h(
    `button.${kind}.h-10.text-sm`,
    { onclick, disabled },
    [label]
  );
}

function legend() {
  return h(
    'div.mt-2.pt-3.border-t.border-white/5.flex.items-center.justify-around.text-xs.font-mono',
    {},
    SUITS.map((s) =>
      h('span.flex.items-center.gap-1', { style: { color: s.color } }, [
        h('span.text-base', {}, [s.glyph]),
        h('span.text-[10px].opacity-70', {}, [s.name]),
      ])
    )
  );
}
