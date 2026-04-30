/**
 * case-page.js
 * Case opening with three tiers, CS:GO-style sliding reel animation,
 * a pity counter display, the "Golden Key" modifier, and a history panel.
 *
 * The server resolves the rarity/reward authoritatively, then we animate a
 * shuffled strip of item tiles sliding past and stopping on the revealed
 * rarity — the strip is purely cosmetic, the slot index is chosen to land
 * on the true outcome.
 */
import { h, mount } from '../../utils/dom.js';
import { appShell } from '../../ui/layout/app-shell.js';
import {
  openCase,
  listRecentOpenings,
  CASE_TIERS,
  RARITY_META,
  RARITY_ORDER,
  PITY_THRESHOLD,
} from '../../games/case/case-api.js';
import { userStore, patchProfile } from '../../state/user-store.js';
import { toastError, toastSuccess } from '../../ui/components/toast.js';
import { formatCredits } from '../../utils/format.js';
import { logger } from '../../lib/logger.js';

export function renderCase(ctx) {
  let selectedTier = 'silver';
  let useKey = false;
  let busy = false;
  let history = [];
  let lastReveal = null; // { rarity, reward, cost, keyUsed, pityPopped }

  const root = h('div.flex.flex-col.gap-4', {}, []);
  const redraw = () => mount(root, view());

  // Load history on mount
  listRecentOpenings(20)
    .then((rows) => { history = rows ?? []; redraw(); })
    .catch((e) => logger.warn('case history load failed', e));

  // Re-render when profile (and thus case_pity) changes.
  const unsub = userStore.subscribe(() => redraw());
  ctx.onCleanup(unsub);

  async function doOpen() {
    if (busy) return;
    const tier = CASE_TIERS.find((t) => t.id === selectedTier);
    const cost = useKey ? Math.floor((tier.cost * 3) / 2) : tier.cost;
    if ((userStore.get().profile?.credits ?? 0) < cost) {
      return toastError('Not enough credits');
    }
    busy = true;
    redraw();

    let result;
    try {
      result = await openCase(selectedTier, useKey);
    } catch (e) {
      toastError(e.message);
      busy = false;
      redraw();
      return;
    }

    // Patch balance immediately (don't wait for realtime).
    patchProfile({ credits: result.newBalance, case_pity: result.pity });

    // Animate the reel landing on the rarity.
    await playReel(reelRef, result.rarity, useKey);

    lastReveal = result;
    history = [rowFromResult(result), ...history].slice(0, 20);

    const profit = result.reward - result.cost;
    if (result.rarity === 'jackpot')      toastSuccess(`🎰 JACKPOT · +${formatCredits(profit)} cr`);
    else if (result.rarity === 'legendary') toastSuccess(`🔥 Legendary · +${formatCredits(profit)} cr`);
    else if (profit > 0)                  toastSuccess(`+${formatCredits(profit)} cr`);
    else if (profit === 0)                toastSuccess('Refunded — break even');
    // else losses are silent; the reveal panel already shows the outcome.

    busy = false;
    redraw();
  }

  // A ref we hand to the reel view so the outer `doOpen` can animate it
  // without React-like re-render pain.
  const reelRef = { el: null, track: null };

  // ---------------- view ----------------
  function view() {
    const tier = CASE_TIERS.find((t) => t.id === selectedTier);
    const cost = useKey ? Math.floor((tier.cost * 3) / 2) : tier.cost;
    const pity = userStore.get().profile?.case_pity ?? 0;
    const pityLeft = Math.max(0, PITY_THRESHOLD - pity);

    return h('div.flex.flex-col.gap-4', {}, [
      // Header
      h('div.flex.items-end.justify-between.gap-3.flex-wrap', {}, [
        h('div', {}, [
          h('h1.text-3xl.font-semibold.heading-grad', {}, ['Cases']),
          h('p.text-sm.text-muted', {}, [
            'Pay a set price, open a chest, let the reel decide. Drops range from nothing to 40×.',
          ]),
        ]),
        pityPanel(pity, pityLeft),
      ]),

      // Tier picker
      h(
        'div.grid.grid-cols-1.md:grid-cols-3.gap-3',
        {},
        CASE_TIERS.map((t) => tierCard(t, selectedTier === t.id, () => {
          selectedTier = t.id; redraw();
        }))
      ),

      // Reel + controls
      h('div.glass.neon-border.p-6.flex.flex-col.gap-5', {}, [
        reelView(reelRef, lastReveal, tier),
        h('div.flex.items-center.justify-between.gap-3.flex-wrap', {}, [
          h('div.flex.flex-col.gap-1', {}, [
            h('span.text-[10px].text-muted.uppercase.tracking-widest', {}, ['Cost']),
            h('span.text-2xl.font-mono.font-bold.text-accent-cyan', {}, [
              `${formatCredits(cost)} cr`,
            ]),
          ]),

          // Golden Key toggle
          h(
            'button.flex.items-center.gap-2.px-3.py-2.rounded-lg.transition-all',
            {
              onclick: () => { useKey = !useKey; redraw(); },
              style: {
                border: useKey ? '1px solid #ffd96b' : '1px solid rgba(255,255,255,0.1)',
                background: useKey
                  ? 'linear-gradient(180deg, rgba(255,217,107,0.18), rgba(138,90,19,0.08))'
                  : 'rgba(255,255,255,0.02)',
                boxShadow: useKey ? '0 0 12px rgba(255,217,107,0.35)' : 'none',
              },
            },
            [
              h('span.text-xl', {}, ['🗝️']),
              h('div.flex.flex-col.items-start.leading-tight', {}, [
                h(`span.text-xs.uppercase.tracking-widest.${useKey ? 'text-[#ffd96b]' : 'text-muted'}`, {}, ['Golden key']),
                h('span.text-[10px].text-muted', {}, ['+50% cost · no commons']),
              ]),
            ]
          ),

          h(
            'button.btn-primary.h-12.px-8.text-base',
            { onclick: doOpen, disabled: busy },
            [busy ? 'Opening…' : `Open ${tier.name}`]
          ),
        ]),
      ]),

      // Rarity odds + history
      h('div.grid.grid-cols-1.lg:grid-cols-2.gap-4', {}, [
        oddsPanel(useKey),
        historyPanel(history),
      ]),
    ]);
  }

  redraw();
  return appShell(root, { wide: true });
}

// ----------------------------------------------------------------------------
// Pieces
// ----------------------------------------------------------------------------

function pityPanel(pity, pityLeft) {
  const pct = Math.min(100, (pity / PITY_THRESHOLD) * 100);
  return h('div.glass.p-3.flex.flex-col.gap-2.min-w-[220px]', {}, [
    h('div.flex.items-center.justify-between.text-[10px].text-muted.uppercase.tracking-widest', {}, [
      h('span', {}, ['Pity counter']),
      h('span', {}, [pityLeft === 0 ? 'RARE GUARANTEED' : `${pityLeft} to bonus`]),
    ]),
    h(
      'div.h-2.rounded-full.overflow-hidden.bg-white/5',
      {},
      [
        h('div.h-full.rounded-full', {
          style: {
            width: `${pct}%`,
            background: pityLeft === 0
              ? 'linear-gradient(90deg, #ffd96b, #ff9a2e)'
              : 'linear-gradient(90deg, #22c2ff, #b06bff)',
            transition: 'width 0.4s ease-out',
            boxShadow: pityLeft === 0 ? '0 0 10px rgba(255,217,107,0.5)' : 'none',
          },
        }, []),
      ]
    ),
    h('span.text-[10px].text-muted.leading-tight', {}, [
      `Every 10 commons, your next non-key open is forced to at least Rare.`,
    ]),
  ]);
}

function tierCard(tier, selected, onClick) {
  return h(
    'button.relative.glass.neon-border.p-5.flex.flex-col.gap-2.text-left.transition-transform.hover:-translate-y-0.5',
    {
      onclick: onClick,
      style: {
        border: selected ? '2px solid #22e1ff' : '1px solid rgba(255,255,255,0.08)',
        boxShadow: selected ? '0 0 16px rgba(34,225,255,0.35)' : 'none',
      },
    },
    [
      h(`div.absolute.inset-0.opacity-40.bg-gradient-to-br.${tier.accent}.rounded-[inherit].pointer-events-none`, {}, []),
      h('div.relative.flex.items-center.justify-between', {}, [
        h('span.text-4xl', {}, [tier.icon]),
        h('span.text-xs.font-mono.font-bold.text-accent-cyan', {}, [`${tier.cost} cr`]),
      ]),
      h('div.relative.flex.flex-col.gap-1', {}, [
        h('span.text-lg.font-semibold', {}, [tier.name]),
        h('span.text-xs.text-white/70', {}, [tier.blurb]),
      ]),
    ]
  );
}

function oddsPanel(useKey) {
  // Odds for display (mirrors the SQL).
  const table = useKey
    ? [
        ['uncommon', 62.2], ['rare', 24.4], ['epic', 8.9],
        ['legendary', 3.8], ['jackpot', 0.7],
      ]
    : [
        ['common', 55.0], ['uncommon', 28.0], ['rare', 11.0],
        ['epic', 4.0], ['legendary', 1.7], ['jackpot', 0.3],
      ];

  return h('div.glass.neon-border.p-4.flex.flex-col.gap-2', {}, [
    h('div.flex.items-center.justify-between', {}, [
      h('h3.text-sm.text-muted.uppercase.tracking-widest', {}, ['Drop odds']),
      useKey
        ? h('span.text-[10px].text-[#ffd96b].uppercase.tracking-widest', {}, ['Key active'])
        : null,
    ]),
    ...table.map(([r, pct]) => {
      const meta = RARITY_META[r];
      return h('div.flex.items-center.gap-3.text-xs', {}, [
        h('span.w-20.font-semibold', { style: { color: meta.color } }, [meta.label]),
        h('div.flex-1.h-2.rounded-full.bg-white/5.overflow-hidden', {}, [
          h('div.h-full', {
            style: {
              width: `${Math.max(1, Math.min(100, pct * 1.2))}%`,
              background: meta.color,
              opacity: 0.7,
            },
          }, []),
        ]),
        h('span.w-12.text-right.font-mono.text-muted', {}, [`${pct.toFixed(1)}%`]),
        h('span.w-14.text-right.font-mono', { style: { color: meta.color } }, [`${meta.mult}×`]),
      ]);
    }),
  ]);
}

function historyPanel(history) {
  return h('div.glass.neon-border.p-4.flex.flex-col.gap-2', {}, [
    h('h3.text-sm.text-muted.uppercase.tracking-widest', {}, ['Your last 20 opens']),
    history.length === 0
      ? h('div.text-xs.text-muted.py-6.text-center', {}, ['No opens yet.'])
      : h(
          'div.flex.flex-col.gap-1.max-h-72.overflow-auto',
          {},
          history.map((row) => {
            const meta = RARITY_META[row.rarity] ?? RARITY_META.common;
            const profit = row.reward - row.cost;
            return h('div.flex.items-center.justify-between.text-xs.px-2.py-1.rounded', {
              style: { background: 'rgba(255,255,255,0.02)' },
            }, [
              h('div.flex.items-center.gap-2.min-w-0', {}, [
                h('span.w-2.h-2.rounded-full.shrink-0', { style: { background: meta.color, boxShadow: `0 0 6px ${meta.glow}` } }, []),
                h('span.font-mono.w-14', {}, [row.tier]),
                h('span.font-semibold.w-20', { style: { color: meta.color } }, [meta.label]),
                row.key_used ? h('span.text-[#ffd96b]', {}, ['🗝️']) : null,
                row.pity_popped ? h('span.text-accent-cyan', {}, ['✦']) : null,
              ]),
              h(
                `span.font-mono.${profit > 0 ? 'text-accent-lime' : profit < 0 ? 'text-accent-rose' : 'text-white/60'}`,
                {},
                [profit === 0 ? '±0' : `${profit > 0 ? '+' : ''}${formatCredits(profit)}`]
              ),
            ]);
          })
        ),
  ]);
}

// ----------------------------------------------------------------------------
// The reel
// ----------------------------------------------------------------------------

const REEL_LENGTH = 40; // number of tiles on the strip
const TILE_WIDTH = 100; // px; matches min-w below

function reelView(ref, lastReveal, tier) {
  // Build a random strip of rarities. The landing index is controlled via
  // `playReel` by nudging the chosen slot's rarity to the actual outcome.
  const tiles = buildStrip(tier);

  const track = h(
    'div.flex.gap-1',
    {
      style: {
        transform: 'translateX(0px)',
        willChange: 'transform',
        transition: 'none',
      },
    },
    tiles.map((r) => tileView(r))
  );

  const window_ = h(
    'div.relative.w-full.h-36.overflow-hidden.rounded-xl',
    {
      style: {
        background: 'linear-gradient(180deg, #0c0d12, #08090c)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: 'inset 0 0 30px rgba(0,0,0,0.7)',
      },
    },
    [
      h('div.absolute.inset-0.flex.items-center', {}, [track]),
      // center pointer
      h('div.absolute.left-1/2.top-0.bottom-0.w-0', {
        style: { transform: 'translateX(-1px)' },
      }, [
        h('div.absolute.-top-1.-translate-x-1/2.w-0.h-0', {
          style: {
            borderLeft: '7px solid transparent',
            borderRight: '7px solid transparent',
            borderTop: '10px solid #ffd96b',
            filter: 'drop-shadow(0 0 3px rgba(255,217,107,0.8))',
          },
        }, []),
        h('div.absolute.inset-y-0.w-px', {
          style: { background: 'linear-gradient(180deg, rgba(255,217,107,0.6), transparent)' },
        }, []),
      ]),
      // side fades
      h('div.absolute.inset-y-0.left-0.w-24.pointer-events-none', {
        style: { background: 'linear-gradient(90deg, rgba(8,9,12,1), rgba(8,9,12,0))' },
      }, []),
      h('div.absolute.inset-y-0.right-0.w-24.pointer-events-none', {
        style: { background: 'linear-gradient(270deg, rgba(8,9,12,1), rgba(8,9,12,0))' },
      }, []),
    ]
  );

  // Hook refs up so playReel can find them.
  ref.el = window_;
  ref.track = track;
  ref.tiles = tiles;

  // Reveal card
  const reveal = lastReveal ? revealView(lastReveal) : null;

  return h('div.flex.flex-col.gap-3', {}, [
    window_,
    reveal ?? h('div.h-14', {}, []),
  ]);
}

function buildStrip(tier) {
  const strip = [];
  // Weighted so the strip visually resembles real odds.
  const weights = {
    common: 55, uncommon: 25, rare: 12, epic: 5, legendary: 2.5, jackpot: 0.5,
  };
  const pool = [];
  for (const r of RARITY_ORDER) {
    const w = Math.max(1, Math.round(weights[r]));
    for (let i = 0; i < w; i++) pool.push(r);
  }
  for (let i = 0; i < REEL_LENGTH; i++) {
    strip.push(pool[Math.floor(Math.random() * pool.length)]);
  }
  return strip;
}

function tileView(rarity) {
  const meta = RARITY_META[rarity];
  return h(
    'div.shrink-0.rounded-lg.flex.flex-col.items-center.justify-center.gap-1.font-semibold.text-xs.text-white',
    {
      style: {
        width: `${TILE_WIDTH - 4}px`,
        height: '116px',
        background: meta.bg,
        border: `1px solid ${meta.color}55`,
        boxShadow: `inset 0 0 14px ${meta.glow}`,
      },
    },
    [
      h('div.text-3xl', {}, [rarityIcon(rarity)]),
      h('div.text-[10px].uppercase.tracking-widest', { style: { color: meta.color } }, [meta.label]),
      h('div.text-[10px].font-mono.text-white/60', {}, [`${meta.mult}×`]),
    ]
  );
}

function rarityIcon(r) {
  return {
    common: '🔩',
    uncommon: '🎖️',
    rare: '💠',
    epic: '🔮',
    legendary: '🏆',
    jackpot: '💰',
  }[r] ?? '❔';
}

function revealView(r) {
  const meta = RARITY_META[r.rarity];
  const profit = r.reward - r.cost;
  return h(
    'div.flex.items-center.justify-between.gap-4.rounded-xl.p-4',
    {
      style: {
        background: meta.bg,
        border: `1px solid ${meta.color}`,
        boxShadow: `0 0 20px ${meta.glow}`,
      },
    },
    [
      h('div.flex.items-center.gap-3', {}, [
        h('span.text-3xl', {}, [rarityIcon(r.rarity)]),
        h('div.flex.flex-col.leading-tight', {}, [
          h('span.text-xs.uppercase.tracking-widest', { style: { color: meta.color } }, [meta.label]),
          h('span.text-sm.text-white', {}, [
            `${r.tier} case · ${meta.mult}× (${formatCredits(r.reward)} cr)`,
          ]),
          h('div.flex.gap-2.mt-1', {}, [
            r.keyUsed ? h('span.text-[10px].text-[#ffd96b]', {}, ['🗝️ key']) : null,
            r.pityPopped ? h('span.text-[10px].text-accent-cyan', {}, ['✦ pity bonus']) : null,
          ]),
        ]),
      ]),
      h(
        `div.text-2xl.font-mono.font-bold.${profit > 0 ? 'text-accent-lime' : profit < 0 ? 'text-accent-rose' : 'text-white'}`,
        {},
        [`${profit > 0 ? '+' : ''}${formatCredits(profit)} cr`]
      ),
    ]
  );
}

function rowFromResult(r) {
  return {
    tier: r.tier,
    rarity: r.rarity,
    reward: r.reward,
    cost: r.cost,
    key_used: r.keyUsed,
    pity_popped: r.pityPopped,
  };
}

// ----------------------------------------------------------------------------
// Reel animation — slide the strip so that the rarity tile at a chosen
// distant index lands under the center pointer with a spring-like ease.
// ----------------------------------------------------------------------------

async function playReel(ref, outcomeRarity, keyUsed) {
  const { el, track, tiles } = ref;
  if (!el || !track || !tiles) return;

  // Pick a far-away landing index (so we see lots of tiles whoosh past).
  // We mutate the tile at that index to be the true outcome so the user
  // sees the correct item under the pointer.
  const landingIdx = tiles.length - 6 - Math.floor(Math.random() * 3); // ~tiles.length-6..8
  tiles[landingIdx] = outcomeRarity;

  // Re-render just the tile that changed. Cheap DOM poke: replace the
  // node in-place.
  const children = track.children;
  if (children[landingIdx]) {
    const fresh = tileView(outcomeRarity);
    children[landingIdx].replaceWith(fresh);
  }

  const rect = el.getBoundingClientRect();
  const centerX = rect.width / 2;

  const tileCenter = landingIdx * (TILE_WIDTH) + TILE_WIDTH / 2;
  // Add a tiny random wiggle so it doesn't always center precisely —
  // more CS:GO-ish.
  const jitter = (Math.random() - 0.5) * (TILE_WIDTH * 0.3);
  const targetX = centerX - tileCenter + jitter;

  // Reset to zero instantly, then ease to target.
  track.style.transition = 'none';
  track.style.transform = 'translateX(0px)';
  // Force reflow so the next assignment animates.
  // eslint-disable-next-line no-unused-expressions
  track.offsetHeight;
  track.style.transition = 'transform 4.2s cubic-bezier(0.15, 0.72, 0.17, 1)';
  track.style.transform = `translateX(${targetX}px)`;

  // Brief post-stop flash on the winning tile.
  await sleep(4300);
  const winTile = track.children[landingIdx];
  if (winTile) {
    winTile.style.transition = 'box-shadow 0.4s';
    winTile.style.boxShadow = `inset 0 0 20px ${RARITY_META[outcomeRarity].glow}, 0 0 30px ${RARITY_META[outcomeRarity].glow}`;
  }
  await sleep(250);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
