/**
 * ambient-overlay.js
 * Listens to the realtime emoji_hunts stream and renders any active hunts
 * **for the current page only** as floating emojis in the #emoji-hunt-layer
 * overlay. Each hunt row carries a `page_path`; only hunts whose page_path
 * matches the current pathname are visible (so a hunt spawned on /games/dice
 * appears only to users currently on /games/dice).
 *
 * Clicking attempts to claim — server-resolved (first-write-wins).
 *
 * The overlay also reacts to the router's `gitm:route` event so navigating
 * to a different page re-evaluates which hunts to show.
 */
import { listActiveHunts, claimHunt, subscribeToHunts, autoSpawnTick } from '../../services/emoji-hunt-service.js';
import { userStore, patchProfile } from '../../state/user-store.js';
import { toastError, toastSuccess } from '../../ui/components/toast.js';
import { logger } from '../../lib/logger.js';

const LAYER_ID = 'emoji-hunt-layer';
// How often each tab nudges the global scheduler. The server is the
// rate limiter: it only spawns when its own gap-timer says it's due, so
// many tabs ticking concurrently cost nothing.
const AUTOSPAWN_TICK_MS = 30_000;

/** @type {Map<string, HTMLElement>} rendered hunts on the current page */
const visible = new Map();
/** @type {Map<string, any>} all known active hunts, keyed by id */
const known = new Map();

let started = false;
let unsubRealtime = null;
let gcInterval = null;
let routeListener = null;
let autoSpawnInterval = null;

export function startEmojiHuntOverlay() {
  if (started) return;
  started = true;

  const layer = document.getElementById(LAYER_ID);
  if (!layer) return;
  layer.replaceChildren();
  layer.style.pointerEvents = 'none';

  // Initial fetch
  listActiveHunts()
    .then((rows) => {
      rows.forEach(track);
      renderForCurrentPage();
    })
    .catch((e) => logger.warn('hunt initial fetch failed', e));

  unsubRealtime = subscribeToHunts({
    onSpawn: (row) => {
      track(row);
      if (matchesCurrentPage(row)) spawn(row);
    },
    onClaim: (row) => {
      known.delete(row.id);
      if (row.found_by) despawn(row.id);
    },
  });

  // GC expired entries client-side
  gcInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, row] of known) {
      if (new Date(row.expires_at).getTime() <= now) {
        known.delete(id);
        despawn(id);
      }
    }
  }, 1000);

  // Re-render when the SPA router changes route.
  routeListener = () => renderForCurrentPage();
  window.addEventListener('gitm:route', routeListener);

  // Auto-spawn ticker. The server holds the rate limit; this is just a
  // nudge so the next-due timer keeps advancing as long as someone is
  // looking at the site. Fire one immediately so a freshly opened tab
  // can witness the very first emoji on a cold install.
  autoSpawnTick().catch((e) => logger.warn('autospawn tick failed', e));
  autoSpawnInterval = setInterval(() => {
    if (document.hidden) return; // backgrounded tabs don't drive the cadence
    autoSpawnTick().catch((e) => logger.warn('autospawn tick failed', e));
  }, AUTOSPAWN_TICK_MS);
}

export function stopEmojiHuntOverlay() {
  unsubRealtime?.();
  unsubRealtime = null;
  if (gcInterval) clearInterval(gcInterval);
  gcInterval = null;
  if (routeListener) window.removeEventListener('gitm:route', routeListener);
  routeListener = null;
  if (autoSpawnInterval) clearInterval(autoSpawnInterval);
  autoSpawnInterval = null;
  for (const id of [...visible.keys()]) despawn(id);
  known.clear();
  started = false;
}

function track(row) {
  if (!row || row.found_by) return;
  if (new Date(row.expires_at).getTime() <= Date.now()) return;
  known.set(row.id, row);
}

function matchesCurrentPage(row) {
  if (!row) return false;
  // Back-compat: legacy rows with null page_path show everywhere.
  if (row.page_path == null) return true;
  return row.page_path === window.location.pathname;
}

function renderForCurrentPage() {
  // remove anything no longer on this page
  for (const id of [...visible.keys()]) {
    const row = known.get(id);
    if (!row || !matchesCurrentPage(row)) despawn(id);
  }
  // add anything new for this page
  for (const row of known.values()) {
    if (matchesCurrentPage(row) && !visible.has(row.id)) spawn(row);
  }
}

function spawn(row) {
  if (visible.has(row.id)) return;
  const layer = document.getElementById(LAYER_ID);
  if (!layer) return;

  const size = clamp(Number(row.size_px) || 56, 32, 128);

  const node = document.createElement('span');
  node.className = 'hunt-emoji';
  node.textContent = row.emoji;
  node.style.left = clamp(row.position_x * 100, 2, 95) + '%';
  node.style.top = clamp(row.position_y * 100, 8, 90) + '%';
  node.style.fontSize = size + 'px';
  node.style.lineHeight = '1';
  // glow scales with size
  node.style.filter = `drop-shadow(0 0 ${Math.round(size / 4)}px rgba(255,255,255,0.35))`;

  // gentle floating; smaller drift for tiny emojis, bigger for large
  const drift = Math.round(size / 8);
  node.animate(
    [
      { transform: 'translate(0,0) rotate(0deg)' },
      { transform: `translate(${drift}px, -${drift * 1.5}px) rotate(8deg)` },
      { transform: `translate(-${drift}px, ${drift}px) rotate(-6deg)` },
      { transform: 'translate(0,0) rotate(0deg)' },
    ],
    { duration: 4000, iterations: Infinity, easing: 'ease-in-out' }
  );

  node.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (node.classList.contains('found')) return;
    node.classList.add('found');

    try {
      const r = await claimHunt(row.id);
      patchProfile({ credits: r.newBalance });
      toastSuccess(`+${r.reward} cr · ${row.emoji}`);
    } catch (err) {
      toastError(err.message ?? 'Already claimed');
    } finally {
      known.delete(row.id);
      despawn(row.id);
    }
  });

  layer.appendChild(node);
  visible.set(row.id, node);
}

function despawn(id) {
  const el = visible.get(id);
  if (!el) return;
  el.remove();
  visible.delete(id);
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

// React to logout: clear the overlay.
userStore.subscribe(({ user }) => {
  if (!user) {
    for (const id of [...visible.keys()]) despawn(id);
    known.clear();
  }
});
