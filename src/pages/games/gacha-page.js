/**
 * gacha-page.js
 *
 * UX (rev 2):
 *   1. User picks a hand size (1, 5, or 10) and presses "Deal hand". The
 *      total cost is debited up-front by the server (`gacha_pull` RPC),
 *      which also commits the rewards immediately — every result is
 *      already locked in by the time the cards arrive on the client.
 *
 *   2. The client renders the hand as N **face-down** 3D cards. Nothing is
 *      revealed yet. The user clicks any card to flip it manually (a real
 *      Y-axis 3D flip via the existing `.card3d` styles in main.css). A
 *      "Flip all" button cascades the remaining cards in tier order so the
 *      best-rarity card always lands last for max suspense.
 *
 *   3. Each individual flip fires a tier-appropriate `feedback-fx` burst:
 *        epic+    → flashSuccessMajor
 *        mythic+  → flashGold
 *        unique   → flashGold + a "ONE OF ONE" toast banner
 *
 *   4. Once every card in the hand is face-up the controls reset and the
 *      "Deal hand" button is re-enabled.
 *
 * The page is fully responsive: the controls collapse under the hand on
 * mobile, the showcase strip uses 2/3/6-column responsive grids, and the
 * card itself is sized off `--gc-card-w` so the same DOM works at every
 * breakpoint.
 *
 * Server is fully authoritative. The reveal animation is purely cosmetic;
 * we never *generate* results client-side.
 */

import { h, mount } from '../../utils/dom.js';
import { appShell } from '../../ui/layout/app-shell.js';
import { userStore, patchProfile } from '../../state/user-store.js';
import { toastError, toastSuccess } from '../../ui/components/toast.js';
import { formatCredits } from '../../utils/format.js';
import { spinner } from '../../ui/components/spinner.js';
import {
  gachaPull,
  listRemainingUniques,
  GACHA_RARITY_META,
  GACHA_COST_SINGLE,
  GACHA_COST_TEN,
  GACHA_PITY_THRESHOLD,
} from '../../games/gacha/gacha-api.js';
import {
  flashSuccess,
  flashSuccessMajor,
  flashGold,
} from '../../ui/fx/feedback-fx.js';

// Hand sizes the user can choose. 5 is the new mid-tier so the pacing
// has three distinct tempos: single (quick dopamine), 5 (a hand), 10
// (the spicy bulk option).
const HAND_SIZES = [1, 5, 10];

// Per-card price (server-side discount applies only at 10).
function priceFor(count) {
  if (count === 10) return GACHA_COST_TEN;
  return GACHA_COST_SINGLE * count;
}

// Stagger between cards when the user hits "Flip all".
const FLIP_ALL_STAGGER_MS = 180;

export function renderGacha(ctx) {
  const root = h('div.flex.flex-col.gap-6', {}, []);

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------
  /** @type {1 | 5 | 10} */
  let pickedSize = 1;
  /** @type {boolean} true while the RPC is in flight. */
  let pulling = false;
  /** @type {Array<{pull: import('../../games/gacha/gacha-api.js').GachaPullRow,
   *               flipped: boolean }>} */
  let hand = [];
  /** True while a "flip all" cascade is mid-animation: blocks user input on
   *  individual cards so we don't double-fire FX. */
  let cascading = false;
  let uniques = [];
  let uniquesLoading = true;

  // The reveal order used by "flip all": indexes into `hand`, sorted so
  // the highest-rarity card is flipped LAST. Recomputed each pull.
  /** @type {number[]} */
  let revealOrder = [];

  ctx.onCleanup(() => {});

  // ---------------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------------
  function refreshUniques() {
    uniquesLoading = true;
    listRemainingUniques()
      .then((rows) => { uniques = rows; uniquesLoading = false; redraw(); })
      .catch(() => { uniquesLoading = false; redraw(); });
  }
  refreshUniques();

  // ---------------------------------------------------------------------
  // Pull
  // ---------------------------------------------------------------------
  async function dealHand() {
    if (pulling || hand.some((c) => !c.flipped)) return;

    // The server only knows about 1 and 10; for the 5-pull mid-tier we
    // call the 1-pull endpoint five times in series. That keeps the
    // server contract unchanged and still gets us per-pull pity logic.
    const count = pickedSize;
    const cost  = priceFor(count);
    const credits = userStore.get().profile?.credits ?? 0;
    if (credits < cost) {
      toastError(`Not enough credits (need ${formatCredits(cost)})`);
      return;
    }

    pulling = true;
    hand = [];
    revealOrder = [];
    redraw();

    try {
      let pulls = [];
      if (count === 1 || count === 10) {
        pulls = await gachaPull(count);
      } else {
        // Five 1-pulls in sequence so credits & pity are charged correctly.
        for (let i = 0; i < count; i++) {
          // eslint-disable-next-line no-await-in-loop
          const single = await gachaPull(1);
          pulls.push(single[0]);
        }
      }

      // Authoritative balance from the last row.
      const last = pulls[pulls.length - 1];
      if (last) patchProfile({ credits: last.newBalance });

      // Build the face-down hand in the order the server returned them.
      hand = pulls.map((p) => ({ pull: p, flipped: false }));

      // Reveal order = indexes sorted by rarity tier ascending, so the
      // highest-rarity card lands last during "Flip all".
      revealOrder = hand
        .map((_, i) => i)
        .sort((a, b) => {
          const ta = GACHA_RARITY_META[hand[a].pull.rarity].tier;
          const tb = GACHA_RARITY_META[hand[b].pull.rarity].tier;
          return ta - tb;
        });
    } catch (err) {
      toastError(err?.message || 'Pull failed');
      hand = [];
      revealOrder = [];
    } finally {
      pulling = false;
      redraw();
    }
  }

  function flipCard(idx) {
    if (cascading) return;
    if (!hand[idx] || hand[idx].flipped) return;
    hand[idx] = { ...hand[idx], flipped: true };
    fireFxFor(hand[idx].pull);
    if (hand[idx].pull.isUnique) refreshUniques();
    redraw();
  }

  async function flipAll() {
    if (cascading || pulling) return;
    const remaining = revealOrder.filter((i) => !hand[i].flipped);
    if (remaining.length === 0) return;
    cascading = true;
    redraw();
    for (const idx of remaining) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(FLIP_ALL_STAGGER_MS);
      hand[idx] = { ...hand[idx], flipped: true };
      fireFxFor(hand[idx].pull);
      if (hand[idx].pull.isUnique) refreshUniques();
      redraw();
    }
    cascading = false;
    redraw();
  }

  function fireFxFor(pull) {
    const meta = GACHA_RARITY_META[pull.rarity];
    if (pull.isUnique) {
      flashGold({ label: `ONE OF ONE · ${pull.name}` });
      toastSuccess(`🌟 ${pull.name} — yours forever`);
      return;
    }
    if (meta.tier >= 5)      flashGold({ label: `${meta.label.toUpperCase()} · ${pull.name}` });
    else if (meta.tier >= 3) flashSuccessMajor({ label: meta.label.toUpperCase() });
    else if (meta.tier >= 1) flashSuccess();
    if (pull.pityPopped) toastSuccess('🎯 Pity guaranteed legendary+ — counter reset');
  }

  // ---------------------------------------------------------------------
  // View
  // ---------------------------------------------------------------------
  function view() {
    const credits = userStore.get().profile?.credits ?? 0;
    const pity    = userStore.get().profile?.gacha_pity ?? 0;
    const allFlipped = hand.length > 0 && hand.every((c) => c.flipped);
    const handReady  = hand.length > 0;

    return h('div.flex.flex-col.gap-4.sm:gap-6', {}, [
      // Header — stacks under the title on mobile, side-by-side from sm+.
      h('div.flex.items-end.justify-between.gap-3.flex-wrap', {}, [
        h('div', {}, [
          h('h1.text-2xl.sm:text-3xl.font-semibold.heading-grad', {}, ['Gacha']),
          h('p.text-xs.sm:text-sm.text-muted.max-w-2xl', {}, [
            'Buy a hand of mystery cards. Flip each one yourself — twelve trophies are ',
            h('span.text-accent-amber', {}, ['one of one']),
            '.',
          ]),
        ]),
        h('div.text-right.flex.flex-col.gap-1', {}, [
          h('span.text-[10px].text-muted.uppercase.tracking-widest', {}, ['Balance']),
          h('span.font-mono.text-base.sm:text-lg.text-accent-cyan', {}, [
            `${formatCredits(credits)} cr`,
          ]),
        ]),
      ]),

      // Stage + controls. On mobile the stage stacks above the controls;
      // from `lg` we go side-by-side (stage 2/3, controls 1/3).
      h('div.grid.grid-cols-1.lg:grid-cols-3.gap-4', {}, [
        // STAGE
        h(
          'div.lg:col-span-2.glass.neon-border.p-4.sm:p-6.flex.flex-col.gap-4.min-h-[20rem] sm:min-h-[26rem]',
          {},
          [
            h('div.flex.items-center.justify-between.gap-3.flex-wrap', {}, [
              h('h2.text-xs.text-muted.uppercase.tracking-widest', {}, ['Your hand']),
              handReady && !allFlipped
                ? h('button.btn-ghost.h-8.px-3.text-[11px].uppercase.tracking-widest', {
                    onclick: flipAll,
                    disabled: cascading,
                  }, [cascading ? 'Flipping…' : 'Flip all'])
                : h('div.text-[11px].text-muted.font-mono', {}, [
                    `pity ${pity} / ${GACHA_PITY_THRESHOLD}`,
                  ]),
            ]),
            stageView({ pulling, hand, allFlipped, onFlip: flipCard, cascading }),
          ]
        ),

        // CONTROLS
        h('div.glass.neon-border.p-4.sm:p-6.flex.flex-col.gap-4', {}, [
          h('h2.text-xs.text-muted.uppercase.tracking-widest', {}, ['Deal']),
          // Hand-size segmented control. Disables while a hand is still
          // being flipped — the user must finish the current hand first.
          h('div.flex.gap-2', {},
            HAND_SIZES.map((n) => {
              const active = pickedSize === n;
              return h('button.flex-1.h-10.rounded-md.text-sm.font-mono.transition.border', {
                onclick: () => { pickedSize = n; redraw(); },
                disabled: pulling || (handReady && !allFlipped),
                class: active
                  ? 'bg-accent-cyan/20 border-accent-cyan text-accent-cyan'
                  : 'bg-white/5 border-white/10 text-white/70 hover:border-white/30',
              }, [`×${n}`]);
            })
          ),
          h('div.text-[11px].text-muted.font-mono.flex.items-center.justify-between', {}, [
            h('span', {}, [`Cost: ${formatCredits(priceFor(pickedSize))} cr`]),
            pickedSize === 10
              ? h('span.text-accent-lime', {}, ['−10% bulk'])
              : null,
          ]),
          h(
            'button.btn-primary.h-12.w-full.text-base.flex.items-center.justify-center.gap-2',
            {
              onclick: dealHand,
              disabled: pulling || credits < priceFor(pickedSize) || (handReady && !allFlipped),
            },
            [
              pulling ? 'Dealing…'
                : (handReady && !allFlipped) ? 'Finish flipping first'
                : `Deal hand · ×${pickedSize}`,
            ]
          ),
          // Pity progress bar.
          h('div.flex.flex-col.gap-1.mt-1', {}, [
            h('div.flex.items-center.justify-between.text-[11px].text-muted', {}, [
              h('span', {}, ['Legendary+ pity']),
              h('span.font-mono', {}, [`${pity}/${GACHA_PITY_THRESHOLD}`]),
            ]),
            h(
              'div.h-2.rounded.bg-white/5.overflow-hidden',
              {},
              [
                h(
                  'div.h-full.bg-gradient-to-r.from-accent-amber.to-accent-rose.transition-all',
                  {
                    style: {
                      width: Math.min(100, (pity / GACHA_PITY_THRESHOLD) * 100).toFixed(0) + '%',
                    },
                  },
                  []
                ),
              ]
            ),
          ]),
          h('div.text-[11px].text-muted.leading-relaxed', {}, [
            'House edge ≈ 5%. Mythic ≈ 1.5%, one-of-one ≈ 0.4% (and shrinking — once a trophy is gone it never returns).',
          ]),
        ]),
      ]),

      // Showcase
      h('section.flex.flex-col.gap-3', {}, [
        h('div.flex.items-end.justify-between.gap-2.flex-wrap', {}, [
          h('h2.text-xs.text-muted.uppercase.tracking-widest', {}, [
            'Trophies · one of one',
          ]),
          uniquesLoading
            ? h('span.text-[11px].text-muted.flex.items-center.gap-2', {}, [
                spinner(), 'Loading…',
              ])
            : h('span.text-[11px].text-muted.font-mono', {}, [
                `${uniques.filter((u) => !u.claimed).length} / ${uniques.length} unclaimed`,
              ]),
        ]),
        uniquesShowcase(uniques),
      ]),
    ]);
  }

  function redraw() { mount(root, view()); }
  redraw();
  return appShell(root);
}

// ---------------------------------------------------------------------------
// Stage: the hand of cards (face-down or revealed).
// ---------------------------------------------------------------------------
function stageView({ pulling, hand, allFlipped, onFlip, cascading }) {
  if (pulling && hand.length === 0) {
    return h(
      'div.flex.items-center.justify-center.text-muted.text-sm.h-56.sm:h-64.border.border-dashed.border-white/10.rounded-2xl.gap-3',
      {},
      [spinner(), 'Dealing your hand…']
    );
  }
  if (hand.length === 0) {
    return h(
      'div.flex.flex-col.items-center.justify-center.text-muted.text-sm.h-56.sm:h-64.border.border-dashed.border-white/10.rounded-2xl.gap-2.text-center.px-4',
      {},
      [
        h('div.text-3xl.opacity-50', {}, ['🎴']),
        h('div', {}, ['Pick a hand size, deal, then flip each card yourself.']),
      ]
    );
  }

  // Layout responds to hand size and viewport. 1 card → centered, big.
  // 5/10 cards → wrap-friendly grid that stays readable on phones (2-cols
  // baseline, 3-cols at sm, 5-cols at md, all 10 in a row at lg).
  let gridClass;
  if (hand.length === 1) {
    gridClass = 'flex justify-center';
  } else if (hand.length === 5) {
    gridClass = 'grid grid-cols-3 sm:grid-cols-5 gap-2 sm:gap-3 justify-items-center';
  } else {
    gridClass = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-5 gap-2 sm:gap-3 justify-items-center';
  }

  return h('div.flex.flex-col.gap-3', {}, [
    h(
      `div.${gridClass.replace(/ /g, '.')}`,
      {},
      hand.map((c, i) => cardView(c, i, onFlip, cascading))
    ),
    allFlipped
      ? h(
          'div.text-[11px].text-center.text-accent-lime.font-mono.uppercase.tracking-widest.pt-1',
          {},
          ['Hand complete — deal again when ready.']
        )
      : null,
  ]);
}

// ---------------------------------------------------------------------------
// One card: either face-down (clickable) or revealed (rarity-styled).
// Uses the .card3d / .card3d-inner / .card3d-face classes already in
// main.css for a real 3D Y-flip on `.flipped`.
// ---------------------------------------------------------------------------
function cardView(c, i, onFlip, cascading) {
  const meta = GACHA_RARITY_META[c.pull.rarity];
  const flipped = c.flipped;
  const clickable = !flipped && !cascading;

  // Per-card sizing. Wider on desktop, snug on mobile so 5 fit a row.
  // Fixed aspect 3/4 with width tied to grid cell so we keep proportions.
  const sizeStyle = {
    width: '100%',
    maxWidth: '8.5rem',
    aspectRatio: '3 / 4',
    height: 'auto',
    perspective: '900px',
  };

  return h(
    'div.card3d.relative' + (flipped ? '.flipped' : '') + (clickable ? '.cursor-pointer' : ''),
    {
      style: { ...sizeStyle, animation: 'cardDealIn 320ms cubic-bezier(0.2, 0.8, 0.2, 1) both' },
      onclick: clickable ? () => onFlip(i) : undefined,
      title: clickable ? 'Click to flip' : (flipped ? c.pull.name : 'Locked'),
    },
    [
      h('div.card3d-inner', {}, [
        // BACK (face-down) — no rarity hints whatsoever.
        h(
          'div.card3d-face.flex.items-center.justify-center.overflow-hidden',
          {
            style: {
              background:
                'linear-gradient(155deg, #1a1d2a 0%, #2a2f48 45%, #1a1d2a 100%)',
              border: '1px solid rgba(255,255,255,0.10)',
              boxShadow: 'inset 0 0 24px rgba(0,0,0,0.5), 0 4px 18px rgba(0,0,0,0.45)',
            },
          },
          [
            h(
              'div.absolute.inset-2.rounded-lg.border.border-white/10.flex.items-center.justify-center',
              {
                style: {
                  background:
                    'repeating-linear-gradient(45deg, rgba(255,255,255,0.04) 0 6px, transparent 6px 12px)',
                },
              },
              [h('div.text-3xl.sm:text-4xl.opacity-70', {}, ['❔'])]
            ),
            clickable
              ? h(
                  'div.absolute.bottom-1.left-0.right-0.text-center.text-[9px].uppercase.tracking-[0.2em].text-white/40.font-mono',
                  {},
                  ['Tap to flip']
                )
              : null,
          ]
        ),

        // FRONT (revealed) — rarity-styled.
        h(
          'div.card3d-face.card3d-front.flex.flex-col.items-center.justify-between.overflow-hidden',
          {
            style: {
              background: `linear-gradient(165deg, rgba(0,0,0,0.45), ${meta.glow.replace(/[\d.]+\)$/, '0.18)')} 60%, rgba(0,0,0,0.6))`,
              boxShadow: `inset 0 0 24px ${meta.glow}, 0 0 22px ${meta.glow}`,
              border: `1px solid ${meta.color}55`,
            },
          },
          [
            // One-of-one breathing ring.
            c.pull.isUnique
              ? h(
                  'div.absolute.inset-0.pointer-events-none.rounded-xl',
                  {
                    style: {
                      boxShadow: `0 0 0 2px ${meta.color}, 0 0 36px ${meta.glow}`,
                      animation: 'gacha-pulse 1.6s ease-in-out infinite',
                    },
                  },
                  []
                )
              : null,
            h(
              'div.w-full.text-center.text-[9px].sm:text-[10px].uppercase.tracking-[0.2em].font-mono.py-1.5',
              { style: { color: meta.color, textShadow: `0 0 6px ${meta.glow}` } },
              [meta.label]
            ),
            h('div.flex-1.w-full.flex.items-center.justify-center', {}, [
              h(
                'span.text-4xl.sm:text-5xl',
                { style: { filter: `drop-shadow(0 0 14px ${meta.glow})` } },
                [c.pull.emoji ?? '🎁']
              ),
            ]),
            h(
              'div.w-full.text-center.font-semibold.text-[11px].sm:text-sm.px-1.sm:px-2.pb-2.truncate',
              { title: c.pull.name, style: { color: '#fff' } },
              [c.pull.name]
            ),
            c.pull.pityPopped
              ? h(
                  'div.absolute.top-1.right-1.text-[9px].font-mono.uppercase.tracking-widest.px-1.5.py-0.5.rounded.bg-accent-amber/20.text-accent-amber.border.border-accent-amber/40',
                  {},
                  ['Pity']
                )
              : null,
          ]
        ),
      ]),
    ]
  );
}

// ---------------------------------------------------------------------------
// One-of-one showcase grid (unchanged from before, just made responsive).
// ---------------------------------------------------------------------------
function uniquesShowcase(rows) {
  if (!rows.length) {
    return h(
      'div.text-muted.text-sm.glass.neon-border.p-6.text-center',
      {},
      ['No trophies seeded yet.']
    );
  }
  return h(
    'div.grid.grid-cols-3.sm:grid-cols-4.md:grid-cols-6.gap-2.sm:gap-3',
    {},
    rows.map((r) => trophyCard(r))
  );
}

function trophyCard(r) {
  const claimed = r.claimed;
  return h(
    'div.relative.aspect-square.rounded-xl.flex.flex-col.items-center.justify-center.overflow-hidden.glass.border.p-1',
    {
      style: {
        borderColor: claimed ? 'rgba(255,255,255,0.06)' : 'rgba(255,234,0,0.5)',
        boxShadow: claimed ? '' : '0 0 18px rgba(255,234,0,0.4)',
        opacity: claimed ? 0.55 : 1,
      },
      title: claimed
        ? `Claimed by ${r.claimedByName ?? 'someone'} on ${r.claimedAt?.toLocaleDateString() ?? '—'}`
        : 'Still in the pool',
    },
    [
      h(
        'span.text-2xl.sm:text-4xl',
        { style: { filter: claimed ? 'grayscale(1)' : 'drop-shadow(0 0 12px rgba(255,234,0,0.7))' } },
        [r.emoji]
      ),
      h(
        'div.text-[9px].sm:text-[10px].font-mono.text-center.mt-1.sm:mt-2.px-1.truncate.w-full',
        { style: { color: claimed ? 'rgba(255,255,255,0.55)' : '#ffea00' } },
        [r.name]
      ),
      claimed
        ? h(
            'div.absolute.bottom-1.left-1.right-1.text-[8px].sm:text-[9px].font-mono.text-center.text-muted.truncate',
            {},
            [`@ ${r.claimedByName ?? '—'}`]
          )
        : h(
            'div.absolute.bottom-1.left-1.right-1.text-[8px].sm:text-[9px].font-mono.text-center.text-accent-amber.uppercase.tracking-widest',
            {},
            ['Available'],
          ),
    ]
  );
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
