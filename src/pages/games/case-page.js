/**
 * case-page.js
 * Case opening with a proper single-stroke reel animation.
 *
 * Flow:
 *   1. User clicks Open. The reel starts spinning at constant velocity
 *      IMMEDIATELY via a rAF loop (no CSS transitions, no transforms waiting
 *      on the RPC). The RPC fires in parallel.
 *   2. Minimum 900 ms of constant velocity is enforced so the spin always
 *      reads even if the server returns instantly.
 *   3. Once the server result is back, the reel calculates a landing tile
 *      that is still ahead of the current position, stamps the server rarity
 *      onto it, and begins a smooth cubic ease-out deceleration.
 *      From click to stop is ONE continuous motion — there is no pause,
 *      no snap, no jump.
 *   4. When the reel stops the winning tile is highlighted in place.
 *
 * Multi-open (3/5/10/20/50) uses a staggered grid reveal instead of a reel.
 */
import { h, mount } from '../../utils/dom.js';
import { appShell } from '../../ui/layout/app-shell.js';
import {
  openCase,
  openCaseBatch,
  listRecentOpenings,
  fetchItem,
  CASE_TIERS,
  RARITY_META,
  RARITY_ORDER,
  RARITY_WEIGHTS,
  BATCH_SIZES,
  PITY_THRESHOLD,
} from '../../games/case/case-api.js';
import { userStore, patchProfile } from '../../state/user-store.js';
import { toastError, toastSuccess } from '../../ui/components/toast.js';
import { formatCredits } from '../../utils/format.js';
import { logger } from '../../lib/logger.js';
import { flashSuccess, flashSuccessMajor, flashGold, flashLoss } from '../../ui/fx/feedback-fx.js';

// ---- Reel tuning ----------------------------------------------------------
const TILE_WIDTH     = 96;      // px — width of one reel tile incl. gap
const VELOCITY       = 2.4;     // px/ms — constant-spin speed (≈2400 px/s)
const MIN_SPIN_MS    = 900;     // minimum spin duration before landing starts
const DECEL_MS       = 3100;    // deceleration phase length (feels weighty)
const MIN_LAND_AHEAD = 1400;    // px of remaining travel required at resolve
const INITIAL_TILES  = 180;     // long enough that we rarely need to extend

export function renderCase(ctx) {
  let selectedTier = 'silver';
  let useKey       = false;
  let batchSize    = 1;
  let busy         = false;
  let history      = [];
  let lastSingle   = null;
  let lastBatch    = null;

  // Persistent references into the DOM for animation. These survive across
  // re-renders because we only redraw outside of the spin window.
  const reel = createReel();
  const grid = { node: null, cells: [] };

  const root = h('div.flex.flex-col.gap-4', {}, []);
  const redraw = () => mount(root, view());

  listRecentOpenings(20)
    .then((rows) => { history = rows ?? []; redraw(); })
    .catch((e) => logger.warn('case history load failed', e));

  const unsub = userStore.subscribe(() => { if (!busy) redraw(); });
  ctx.onCleanup(() => { unsub(); reel.destroy(); });

  // --------------------------------------------------------------------------
  // Open handler
  // --------------------------------------------------------------------------
  async function doOpen() {
    if (busy) return;
    const tier = CASE_TIERS.find((t) => t.id === selectedTier);
    const perCost = useKey ? Math.floor((tier.cost * 3) / 2) : tier.cost;
    const count = batchSize;
    const total = perCost * count;
    if ((userStore.get().profile?.credits ?? 0) < total) {
      return toastError(`Not enough credits (need ${formatCredits(total)})`);
    }

    busy = true;
    lastSingle = null;
    lastBatch = null;
    redraw();                     // lock controls, clear prior reveal card

    try {
      if (count === 1) {
        // Kick the reel off before the RPC — the spin must already be in
        // motion by the time the server replies, otherwise you get the
        // "click → pause → jump" bug.
        reel.start();

        // Fire the RPC + enforce a minimum spin duration in parallel.
        const rpcPromise = openCase(selectedTier, useKey);
        await sleep(MIN_SPIN_MS);
        const result = await rpcPromise;
        patchProfile({ credits: result.newBalance, case_pity: result.pity });

        // One continuous motion → cubic ease-out onto the server rarity.
        await reel.landOn(result.rarity);

        lastSingle = result;
        history = [rowFromResult(result), ...history].slice(0, 20);
        flashToast(result.reward - result.cost, result.rarity);
        // Cosmetic drop? Fetch its metadata and show a follow-up toast.
        if (result.droppedItem) announceItemDrop(result.droppedItem);
      } else {
        const batch = await openCaseBatch(selectedTier, useKey, count);
        const credDelta = batch.reduce((s, r) => s + r.reward, 0) - total;
        patchProfile({ credits: (userStore.get().profile?.credits ?? 0) + credDelta });
        lastBatch = batch;
        history = [
          ...batch.slice().reverse().map((r) => ({
            tier: selectedTier, cost: perCost, rarity: r.rarity,
            reward: r.reward, key_used: useKey, pity_popped: r.pityHit,
          })),
          ...history,
        ].slice(0, 20);
        await animateBatchReveal(grid, batch);
        const profit = credDelta;
        const jackpots = batch.filter((r) => r.rarity === 'jackpot' || r.rarity === 'ultra').length;
        if (jackpots > 0)       toastSuccess(`${jackpots}× big hit! Net ${profit >= 0 ? '+' : ''}${formatCredits(profit)} cr`);
        else if (profit > 0)    toastSuccess(`+${formatCredits(profit)} cr across ${count} cases`);

        // Collect cosmetic drops from the batch and announce each.
        const drops = batch.filter((r) => r.droppedItem).map((r) => r.droppedItem);
        if (drops.length > 0) {
          // Small delay so the toast stacks after the summary toast.
          setTimeout(() => {
            if (drops.length === 1) {
              announceItemDrop(drops[0]);
            } else {
              toastSuccess(`🎁 ${drops.length} cosmetic drops! Check the Market → Inventory.`);
            }
          }, 400);
        }
      }
    } catch (e) {
      reel.abort();
      toastError(e.message ?? String(e));
    } finally {
      busy = false;
      redraw();
    }
  }

  function flashToast(profit, rarity) {
    // Toast first.
    if (rarity === 'ultra')          toastSuccess(`🌌 ULTRA · +${formatCredits(profit)} cr`);
    else if (rarity === 'jackpot')   toastSuccess(`🎰 JACKPOT · +${formatCredits(profit)} cr`);
    else if (rarity === 'legendary') toastSuccess(`🔥 Legendary · +${formatCredits(profit)} cr`);
    else if (profit > 0)             toastSuccess(`+${formatCredits(profit)} cr`);
    else if (profit === 0)           toastSuccess('Refunded — break even');

    // Full-screen dopamine layer, calibrated to the rarity ladder.
    if (rarity === 'ultra' || rarity === 'jackpot') {
      flashGold({ label: rarity === 'ultra' ? 'ULTRA' : 'JACKPOT' });
    } else if (rarity === 'legendary') {
      flashSuccessMajor({ label: 'LEGENDARY' });
    } else if (rarity === 'epic') {
      flashSuccessMajor({ label: 'EPIC' });
    } else if (profit > 0) {
      flashSuccess();
    } else if (profit < 0) {
      flashLoss();
    }
  }

  async function announceItemDrop(itemId) {
    try {
      const item = await fetchItem(itemId);
      if (!item) {
        toastSuccess('🎁 Cosmetic drop! Check Market → Inventory.');
        return;
      }
      const meta = RARITY_META[item.rarity] ?? RARITY_META.common;
      const emoji = item.metadata?.emoji ?? '🎁';
      toastSuccess(`${emoji} Cosmetic drop: ${meta.label} — ${item.name}`);
    } catch {
      toastSuccess('🎁 Cosmetic drop! Check Market → Inventory.');
    }
  }

  // --------------------------------------------------------------------------
  // View
  // --------------------------------------------------------------------------
  function view() {
    const tier = CASE_TIERS.find((t) => t.id === selectedTier);
    const perCost = useKey ? Math.floor((tier.cost * 3) / 2) : tier.cost;
    const totalCost = perCost * batchSize;
    const pity = userStore.get().profile?.case_pity ?? 0;
    const pityLeft = Math.max(0, PITY_THRESHOLD - pity);

    return h('div.flex.flex-col.gap-4', {}, [
      h('div.flex.items-end.justify-between.gap-3.flex-wrap', {}, [
        h('div', {}, [
          h('h1.text-3xl.font-semibold.heading-grad', {}, ['Cases']),
          h('p.text-sm.text-muted', {}, [
            'Pay, spin, see where it lands. Drops range from nothing to 100×.',
          ]),
        ]),
        pityPanel(pity, pityLeft, useKey),
      ]),

      h('div.grid.grid-cols-1.md:grid-cols-3.gap-3', {},
        CASE_TIERS.map((t) => tierCard(t, selectedTier === t.id, () => {
          if (busy) return;
          selectedTier = t.id; redraw();
        }))
      ),

      h('div.glass.neon-border.p-6.flex.flex-col.gap-5', {}, [
        batchSize === 1
          ? reelView(reel, lastSingle)
          : batchGridView(grid, batchSize, lastBatch),

        h('div.flex.flex-col.gap-3', {}, [
          h('div.flex.items-center.gap-2.flex-wrap', {}, [
            h('span.text-[10px].text-muted.uppercase.tracking-widest.mr-2', {}, ['Open']),
            ...[1, ...BATCH_SIZES].map((n) =>
              h(
                'button.px-3.h-9.rounded-lg.text-xs.font-mono.font-bold.transition-colors',
                {
                  onclick: () => { if (!busy) { batchSize = n; redraw(); } },
                  style: {
                    background: batchSize === n ? 'rgba(34,225,255,0.15)' : 'rgba(255,255,255,0.03)',
                    border:     batchSize === n ? '1px solid #22e1ff' : '1px solid rgba(255,255,255,0.08)',
                    color:      batchSize === n ? '#22e1ff' : '#fff',
                  },
                },
                [n === 1 ? '×1' : `×${n}`]
              )
            ),
          ]),

          h('div.flex.items-center.justify-between.gap-3.flex-wrap', {}, [
            h('div.flex.flex-col.gap-1', {}, [
              h('span.text-[10px].text-muted.uppercase.tracking-widest', {}, ['Total cost']),
              h('span.text-2xl.font-mono.font-bold.text-accent-cyan', {}, [`${formatCredits(totalCost)} cr`]),
              batchSize > 1 ? h('span.text-[10px].text-muted', {}, [`${formatCredits(perCost)} × ${batchSize}`]) : null,
            ]),

            h(
              'button.flex.items-center.gap-2.px-3.py-2.rounded-lg.transition-all',
              {
                onclick: () => { if (!busy) { useKey = !useKey; redraw(); } },
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
                  h('span.text-[10px].text-muted', {}, ['+50% cost · reroll commons']),
                ]),
              ]
            ),

            h('button.btn-primary.h-12.px-8.text-base',
              { onclick: doOpen, disabled: busy },
              [busy ? 'Opening…' : batchSize === 1 ? `Open ${tier.name}` : `Open ×${batchSize}`]
            ),
          ]),
        ]),
      ]),

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
// Reel engine — rAF-driven, single continuous motion
// ----------------------------------------------------------------------------
/**
 * Returns an object that owns its own DOM subtree and animation state.
 * Re-attached on every redraw via `reel.mount(containerEl)`.
 *
 * Phases:
 *   'idle'     → at rest, transform = 0
 *   'spin'     → constant-velocity linear scroll (rAF)
 *   'decel'    → cubic ease-out from current x to targetX over DECEL_MS
 *   'done'     → landed; winning tile glows
 */
function createReel() {
  // Build the persistent strip once.
  const tiles = buildStrip(INITIAL_TILES);
  const track = document.createElement('div');
  track.style.display = 'flex';
  track.style.gap = '4px';
  track.style.willChange = 'transform';
  track.style.transform = 'translate3d(0,0,0)';
  track.style.transition = 'none';
  for (const r of tiles) track.appendChild(tileNode(r));

  const viewport = document.createElement('div');
  viewport.className = 'absolute inset-0 flex items-center';
  viewport.appendChild(track);

  // Animation state
  let phase = 'idle';
  let x = 0;
  let lastT = 0;
  let rafId = null;
  let decelFrom = 0;
  let decelTarget = 0;
  let decelStart = 0;
  let landIdx = -1;
  let landingPromise = null;
  let landingResolve = null;

  function step(t) {
    if (!lastT) lastT = t;
    const dt = t - lastT;
    lastT = t;

    if (phase === 'spin') {
      x -= VELOCITY * dt;
      // Safety: if we ever approach the strip's end during constant spin,
      // append more tiles so the scroll never runs out.
      ensureStripLength(Math.ceil((-x + 3000) / TILE_WIDTH));
      track.style.transform = `translate3d(${x}px,0,0)`;
      rafId = requestAnimationFrame(step);
    } else if (phase === 'decel') {
      const p = Math.min(1, (t - decelStart) / DECEL_MS);
      // Cubic ease-out — smooth deceleration, no final snap.
      const eased = 1 - Math.pow(1 - p, 3);
      x = decelFrom + (decelTarget - decelFrom) * eased;
      track.style.transform = `translate3d(${x}px,0,0)`;
      if (p >= 1) {
        phase = 'done';
        rafId = null;
        x = decelTarget;
        track.style.transform = `translate3d(${x}px,0,0)`;
        highlightWinner();
        landingResolve?.();
      } else {
        rafId = requestAnimationFrame(step);
      }
    }
  }

  function ensureStripLength(minTiles) {
    while (tiles.length < minTiles) {
      const r = randomTileRarity();
      tiles.push(r);
      track.appendChild(tileNode(r));
    }
  }

  function highlightWinner() {
    const node = track.children[landIdx];
    if (!node) return;
    const meta = RARITY_META[tiles[landIdx]];
    node.style.transition = 'box-shadow 0.35s ease-out, transform 0.35s ease-out';
    node.style.boxShadow  = `inset 0 0 20px ${meta.glow}, 0 0 28px ${meta.glow}`;
    node.style.transform  = 'scale(1.05)';
  }

  function clearWinnerHighlight() {
    for (const el of track.children) {
      el.style.transition = 'none';
      el.style.boxShadow = 'none';
      el.style.transform = '';
    }
  }

  function start() {
    abort();
    clearWinnerHighlight();
    phase = 'spin';
    lastT = 0;
    // Don't reset x — if the user opens again we want to continue scrolling
    // rather than snap back. But do reset on first ever spin so the motion
    // feels fresh.
    if (x === 0 || x > -TILE_WIDTH * 4) x = 0;
    rafId = requestAnimationFrame(step);
  }

  /**
   * Resolve the spin to land on the given rarity. Returns a promise that
   * settles when the deceleration finishes. Called with the server result.
   */
  function landOn(rarity) {
    if (phase !== 'spin') {
      // Corner case: if start() wasn't called (shouldn't happen), just teleport.
      phase = 'spin';
      x = 0;
      lastT = performance.now();
    }

    // Viewport centre in track-local coords.
    const viewportWidth = viewport.getBoundingClientRect().width;
    const centerX = viewportWidth / 2;

    // Compute the minimum landing tile index such that the tile's centre is
    // strictly further than the current scroll position plus MIN_LAND_AHEAD.
    // Target x for a tile at index i is:
    //   targetX = -(i*TW + TW/2 - centerX + jitter)
    // We need targetX < x - MIN_LAND_AHEAD (i.e. further left).
    //   i > (x - MIN_LAND_AHEAD - centerX) / -TW  + 0.5
    //   i > (-x + MIN_LAND_AHEAD + centerX)/TW - 0.5
    const minIdx = Math.ceil((-x + MIN_LAND_AHEAD + centerX) / TILE_WIDTH + 1);
    // Add a few random extra tiles of travel so landings vary.
    landIdx = minIdx + Math.floor(Math.random() * 4);
    ensureStripLength(landIdx + 8);

    // Stamp the server rarity onto the landing tile so when it glides into
    // view the right one is there.
    tiles[landIdx] = rarity;
    const replacement = tileNode(rarity);
    track.children[landIdx].replaceWith(replacement);

    const jitter = (Math.random() - 0.5) * (TILE_WIDTH * 0.34);
    decelTarget = -(landIdx * TILE_WIDTH + TILE_WIDTH / 2 - centerX + jitter);
    decelFrom   = x;
    decelStart  = performance.now();
    phase       = 'decel';
    // Ensure the rAF loop is alive (it should be, but just in case).
    if (rafId == null) rafId = requestAnimationFrame(step);

    landingPromise = new Promise((resolve) => { landingResolve = resolve; });
    return landingPromise;
  }

  function abort() {
    if (rafId != null) cancelAnimationFrame(rafId);
    rafId = null;
    phase = 'idle';
    lastT = 0;
  }

  function destroy() {
    abort();
  }

  function getNode() { return viewport; }

  return { start, landOn, abort, destroy, getNode };
}

function randomTileRarity() {
  // Weighted pool biased so rarer tiles are still visible during the spin.
  const mapping = {
    common: 38, uncommon: 24, rare: 14, epic: 8, legendary: 6, jackpot: 5, ultra: 3,
  };
  const pool = [];
  for (const r of RARITY_ORDER) for (let i = 0; i < mapping[r]; i++) pool.push(r);
  return pool[(Math.random() * pool.length) | 0];
}

function buildStrip(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(randomTileRarity());
  return out;
}

function tileNode(rarity) {
  const meta = RARITY_META[rarity];
  const el = document.createElement('div');
  el.style.flex = '0 0 auto';
  el.style.width = `${TILE_WIDTH - 4}px`;
  el.style.height = '104px';
  el.style.borderRadius = '8px';
  el.style.background = meta.bg;
  el.style.border = `1px solid ${meta.color}55`;
  el.style.display = 'flex';
  el.style.flexDirection = 'column';
  el.style.alignItems = 'center';
  el.style.justifyContent = 'center';
  el.style.gap = '4px';
  el.style.fontSize = '12px';
  el.style.color = '#fff';
  el.style.fontWeight = '600';

  const icon = document.createElement('div');
  icon.textContent = rarityIcon(rarity);
  icon.style.fontSize = '28px';

  const label = document.createElement('div');
  label.textContent = meta.label;
  label.style.fontSize = '10px';
  label.style.textTransform = 'uppercase';
  label.style.letterSpacing = '0.08em';
  label.style.color = meta.color;

  const mult = document.createElement('div');
  mult.textContent = `${meta.mult}×`;
  mult.style.fontSize = '10px';
  mult.style.fontFamily = 'ui-monospace, SFMono-Regular, monospace';
  mult.style.color = 'rgba(255,255,255,0.6)';

  el.appendChild(icon);
  el.appendChild(label);
  el.appendChild(mult);
  return el;
}

// ----------------------------------------------------------------------------
// Panels
// ----------------------------------------------------------------------------

function pityPanel(pity, pityLeft, keyActive) {
  const pct = Math.min(100, (pity / PITY_THRESHOLD) * 100);
  return h('div.glass.p-3.flex.flex-col.gap-2.min-w-[240px]', {}, [
    h('div.flex.items-center.justify-between.text-[10px].text-muted.uppercase.tracking-widest', {}, [
      h('span', {}, ['Pity counter']),
      h('span', {}, [pityLeft === 0 ? 'RARE GUARANTEED' : `${pityLeft} to bonus`]),
    ]),
    h('div.h-2.rounded-full.overflow-hidden.bg-white/5', {}, [
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
    ]),
    h('span.text-[10px].text-muted.leading-tight', {}, [
      keyActive
        ? 'Key opens do not affect pity. Open without a key to progress the counter.'
        : 'Every 10 commons in a row, your next open is forced to at least Rare.',
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
  const base = RARITY_WEIGHTS;
  const pc = base.common / 100;
  const keyAdjusted = Object.fromEntries(
    RARITY_ORDER.map((r) => {
      const p = base[r] / 100;
      if (r === 'common') return [r, p * p * 100];
      return [r, (p + pc * p) * 100];
    })
  );
  const table = useKey ? keyAdjusted : base;

  return h('div.glass.neon-border.p-4.flex.flex-col.gap-2', {}, [
    h('div.flex.items-center.justify-between', {}, [
      h('h3.text-sm.text-muted.uppercase.tracking-widest', {}, ['Drop odds']),
      useKey ? h('span.text-[10px].text-[#ffd96b].uppercase.tracking-widest', {}, ['Key active']) : null,
    ]),
    ...RARITY_ORDER.map((r) => {
      const meta = RARITY_META[r];
      const pct = table[r];
      if (pct < 0.001) return null;
      return h('div.flex.items-center.gap-3.text-xs', {}, [
        h('span.w-20.font-semibold', { style: { color: meta.color } }, [meta.label]),
        h('div.flex-1.h-2.rounded-full.bg-white/5.overflow-hidden', {}, [
          h('div.h-full', {
            style: { width: `${Math.max(1, Math.min(100, pct * 1.2))}%`, background: meta.color, opacity: 0.7 },
          }, []),
        ]),
        h('span.w-14.text-right.font-mono.text-muted', {}, [pct >= 1 ? `${pct.toFixed(1)}%` : `${pct.toFixed(2)}%`]),
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
      : h('div.flex.flex-col.gap-1.max-h-72.overflow-auto', {},
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
// Reel view (single open)
// ----------------------------------------------------------------------------

function reelView(reel, lastReveal) {
  // Wrap the reel's persistent node inside a fresh viewport box every redraw.
  const frame = h(
    'div.relative.w-full.h-32.overflow-hidden.rounded-xl',
    {
      style: {
        background: 'linear-gradient(180deg, #0c0d12, #08090c)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: 'inset 0 0 30px rgba(0,0,0,0.7)',
      },
    },
    [
      // The pointer
      h('div.absolute.left-1/2.top-0.bottom-0.w-0.z-10', {
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
      // Edge fades
      h('div.absolute.inset-y-0.left-0.w-20.pointer-events-none.z-10', {
        style: { background: 'linear-gradient(90deg, rgba(8,9,12,1), rgba(8,9,12,0))' },
      }, []),
      h('div.absolute.inset-y-0.right-0.w-20.pointer-events-none.z-10', {
        style: { background: 'linear-gradient(270deg, rgba(8,9,12,1), rgba(8,9,12,0))' },
      }, []),
    ]
  );
  // Attach the persistent reel node on next microtask so frame is mounted.
  queueMicrotask(() => {
    const node = reel.getNode();
    if (node.parentElement !== frame) frame.insertBefore(node, frame.firstChild);
  });

  return h('div.flex.flex-col.gap-3', {}, [
    frame,
    lastReveal ? revealView(lastReveal) : h('div.h-14', {}, []),
  ]);
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
    tier: r.tier, rarity: r.rarity, reward: r.reward, cost: r.cost,
    key_used: r.keyUsed, pity_popped: r.pityPopped,
  };
}

function rarityIcon(r) {
  return {
    common: '🔩', uncommon: '🎖️', rare: '💠', epic: '🔮',
    legendary: '🏆', jackpot: '💰', ultra: '🌌',
  }[r] ?? '❔';
}

// ----------------------------------------------------------------------------
// Batch grid (multi-open)
// ----------------------------------------------------------------------------

function batchGridView(ref, count, lastBatch) {
  const cols = count <= 5 ? count : count <= 10 ? 5 : count <= 20 ? 5 : 10;
  ref.cells = [];
  const grid = h('div.grid.gap-2', {
    style: { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, minHeight: '96px' },
  }, Array.from({ length: count }, (_, i) => {
    const slot = lastBatch ? revealedCell(lastBatch[i]) : closedCell();
    ref.cells.push(slot);
    return slot;
  }));
  ref.node = grid;
  return h('div.flex.flex-col.gap-3', {}, [
    grid,
    lastBatch ? batchSummary(lastBatch) : h('div.h-6', {}, []),
  ]);
}

function closedCell() {
  return h('div.rounded-lg.flex.items-center.justify-center.text-2xl', {
    style: {
      aspectRatio: '1 / 1',
      background: 'linear-gradient(180deg, #1a1d25, #0d1016)',
      border: '1px solid rgba(255,255,255,0.06)',
      transition: 'transform 180ms, box-shadow 180ms',
    },
  }, ['📦']);
}

function revealedCell(r) {
  const meta = RARITY_META[r.rarity];
  return h('div.rounded-lg.flex.flex-col.items-center.justify-center.gap-0.5.text-center.p-1', {
    style: {
      aspectRatio: '1 / 1',
      background: meta.bg,
      border: `1px solid ${meta.color}55`,
      boxShadow: `inset 0 0 10px ${meta.glow}`,
      transition: 'transform 180ms',
    },
  }, [
    h('div.text-xl', {}, [rarityIcon(r.rarity)]),
    h('div.text-[9px].uppercase.tracking-widest.font-bold', { style: { color: meta.color } }, [meta.label]),
    h('div.text-[9px].font-mono.text-white/70', {}, [`+${formatCredits(r.reward)}`]),
  ]);
}

function batchSummary(batch) {
  const counts = {};
  let gross = 0;
  let highlight = null;
  for (const r of batch) {
    counts[r.rarity] = (counts[r.rarity] ?? 0) + 1;
    gross += r.reward;
    const order = ['common','uncommon','rare','epic','legendary','jackpot','ultra'];
    if (!highlight || order.indexOf(r.rarity) > order.indexOf(highlight)) highlight = r.rarity;
  }
  const hMeta = RARITY_META[highlight];
  return h('div.flex.items-center.justify-between.gap-4.rounded-xl.p-3', {
    style: {
      background: hMeta.bg,
      border: `1px solid ${hMeta.color}88`,
      boxShadow: `0 0 16px ${hMeta.glow}`,
    },
  }, [
    h('div.flex.items-center.gap-3.flex-wrap', {},
      RARITY_ORDER.filter((r) => counts[r]).map((r) => {
        const m = RARITY_META[r];
        return h('span.flex.items-center.gap-1.text-[11px]', {}, [
          h('span.w-2.h-2.rounded-full', { style: { background: m.color } }, []),
          h('span.font-mono', { style: { color: m.color } }, [`${counts[r]}× ${m.label}`]),
        ]);
      })
    ),
    h('div.text-right', {}, [
      h('div.text-[10px].text-muted.uppercase.tracking-widest', {}, ['Gross reward']),
      h('div.text-lg.font-mono.font-bold.text-accent-lime', {}, [`+${formatCredits(gross)} cr`]),
    ]),
  ]);
}

async function animateBatchReveal(ref, batch) {
  const { cells } = ref;
  if (!cells) return;
  const step = batch.length <= 10 ? 120 : batch.length <= 20 ? 70 : 40;
  for (let i = 0; i < batch.length; i++) {
    const oldCell = cells[i];
    const fresh = revealedCell(batch[i]);
    fresh.style.transform = 'scale(0.6)';
    fresh.style.opacity = '0.0';
    oldCell.replaceWith(fresh);
    cells[i] = fresh;
    // eslint-disable-next-line no-unused-expressions
    fresh.offsetHeight;
    fresh.style.transition = 'transform 180ms cubic-bezier(.2,1.3,.5,1), opacity 180ms';
    fresh.style.transform = 'scale(1)';
    fresh.style.opacity = '1';
    await sleep(step);
  }
  await sleep(150);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
