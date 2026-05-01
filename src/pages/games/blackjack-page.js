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
import {
  flashSuccess, flashSuccessMajor,
  flashLoss, flashLossMajor,
  flashGold, flashGoldSubtle,
} from '../../ui/fx/feedback-fx.js';

export function renderBlackjack() {
  /** @type {any|null} server-returned blackjack_hands row */
  let state = null;
  let busy = false;

  // Per-page bookkeeping for animations:
  //   `seen`     — cards we've already rendered face-up at least once, so we
  //                don't replay the flip on every redraw.
  //   `fxKey`    — last `state.id|status` we fired outcome FX for; ensures the
  //                celebration plays exactly once per resolved round.
  const seen = new Set();
  let fxKey = null;

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

    // Fire outcome animations once per resolved round.
    queueMicrotask(() => maybeFireOutcomeFx(state));

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
                cardKeyPrefix: `${state?.id ?? 'pre'}|d`,
                seen,
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
                        cardKeyPrefix: `${state.id}|p${idx}`,
                        seen,
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

  // Fire celebratory / commiserating FX exactly once per resolved round,
  // tailored to the worst-or-best beat of the table.
  function maybeFireOutcomeFx(s) {
    if (!s || s.status !== 'done') return;
    const key = `${s.id}|${s.status}`;
    if (fxKey === key) return;
    fxKey = key;

    const dealer = s.dealer_cards ?? [];
    const dealerTot = handTotal(dealer);
    const dealerBust = dealerTot > 21;
    const dealerHas21 = dealerTot === 21;

    // Worst beat first: dealer makes 21 / blackjack — the strongest negative.
    if (dealerHas21 && (s.hands ?? []).every((hd) => !['win', 'blackjack'].includes(hd.result))) {
      flashLossMajor({ label: dealerTot === 21 && dealer.length === 2 ? 'DEALER BLACKJACK' : 'DEALER 21', intense: true });
      return;
    }

    // Aggregate player results into one dominant beat. We pick the most
    // impactful single hand: blackjack > win > push > bust > lose.
    const order = { blackjack: 5, win: 4, push: 3, bust: 2, lose: 1, surrender: 0 };
    const best = (s.hands ?? []).reduce((acc, hd) => {
      const o = order[hd.result] ?? -1;
      return o > (acc.o ?? -2) ? { o, hd } : acc;
    }, {}).hd;
    if (!best) return;

    const playerTot = handTotal(best.cards ?? []);
    if (best.result === 'blackjack' || (best.result === 'win' && playerTot === 21)) {
      flashGold({ label: best.result === 'blackjack' ? 'BLACKJACK!' : '21!' });
    } else if (best.result === 'win' && dealerBust) {
      flashSuccessMajor({ label: 'DEALER BUSTS' });
    } else if (best.result === 'win') {
      flashSuccessMajor({ label: 'WIN' });
    } else if (best.result === 'push') {
      flashSuccess();
    } else if (best.result === 'bust') {
      flashLossMajor({ label: 'BUST', intense: true });
    } else if (best.result === 'surrender') {
      flashLoss();
    } else if (best.result === 'lose') {
      // Soft loss unless dealer cooked us — a 20 against dealer 21 already
      // covered above. Plain lose just gets a light sting.
      if (playerTot === 20) flashGoldSubtle({ label: 'CLOSE — 20' });
      flashLoss();
    }
  }

  redraw();
  return appShell(root);
}

// ---------------------------------------------------------------------------
// View helpers
// ---------------------------------------------------------------------------

function dealerMustReveal(_state) {
  // Reserved hook: server controls reveal via `status === 'done'`. Kept as a
  // single source of truth in case we later want to pre-reveal on bust.
  return false;
}

function handBlock(name, cards, opts = {}) {
  const prefix = opts.cardKeyPrefix ?? '';
  const seen = opts.seen;
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
      cards.map((c, i) => card3d(c, `${prefix}|${i}|${c ?? 'X'}`, seen))
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

/**
 * Single card slot rendered as a 3D-flippable element. If `card` is null we
 * show the back side (e.g. dealer hole card pre-reveal). When the card has
 * never been seen face-up before in this round, we render it back-side-up
 * and flip it on the next frame, producing a real flip animation.
 *
 * `seen` is a Set carried on the page closure so the flip animation plays
 * exactly once per logical card; subsequent redraws (insurance, splits,
 * outcome FX) leave already-revealed cards unchanged.
 */
function card3d(card, key, seen) {
  const inner = h('div.card3d-inner', {}, [
    h('div.card3d-face.card3d-back', {
      style: {
        background:
          'repeating-linear-gradient(45deg, #1a2040, #1a2040 6px, #2a3070 6px, #2a3070 12px)',
        boxShadow:
          '0 4px 12px rgba(0,0,0,0.4), inset 0 0 12px rgba(34,225,255,0.25)',
        border: '1px solid rgba(255,255,255,0.10)',
      },
    }, []),
    h('div.card3d-face.card3d-front', {
      style: { transformOrigin: 'center' },
    }, card == null ? [] : [cardFaceContent(card)]),
  ]);

  const root = h('div.card3d', {}, [inner]);

  if (card == null) {
    // Pure back — no animation.
    return root;
  }

  // We have a real card. Decide: flip-in animation or instant face-up?
  if (seen && !seen.has(key)) {
    seen.add(key);
    // Start back-up, then flip on next frame so the transition runs.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => root.classList.add('flipped'));
    });
    root.classList.add('deal-in');
  } else {
    // Already seen on a previous redraw — render face-up immediately.
    root.classList.add('flipped');
  }
  root.dataset.rank = String(rankOf(card));
  root.dataset.suit = suitOf(card).name;
  return root;
}

function cardFaceContent(card) {
  const suit = suitOf(card);
  const label = rankLabel(card);
  return h(
    'div.absolute.inset-0.rounded-xl.border.border-black/30.shadow-card.flex.flex-col.justify-between.p-1.5.font-bold',
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
          h('span.text-3xl', { style: { color: suit.color, opacity: 0.9 } }, [
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
  // Use `colorOnDark` so spades (and any other dark-on-light suit) stays
  // legible against the app's dark glass surface.
  return h(
    'div.mt-2.pt-3.border-t.border-white/5.flex.items-center.justify-around.text-xs.font-mono',
    {},
    SUITS.map((s) =>
      h('span.flex.items-center.gap-1', { style: { color: s.colorOnDark } }, [
        h('span.text-base', {}, [s.glyph]),
        h('span.text-[10px].opacity-70', {}, [s.name]),
      ])
    )
  );
}
