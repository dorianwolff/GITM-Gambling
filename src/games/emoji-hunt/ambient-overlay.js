/**
 * ambient-overlay.js
 * Listens to the realtime emoji_hunts stream and renders any active hunts as
 * floating emojis in the #emoji-hunt-layer overlay. Clicking attempts to
 * claim — server-resolved (first-write-wins).
 */
import { listActiveHunts, claimHunt, subscribeToHunts } from '../../services/emoji-hunt-service.js';
import { userStore, patchProfile } from '../../state/user-store.js';
import { toastError, toastSuccess } from '../../ui/components/toast.js';
import { logger } from '../../lib/logger.js';

const LAYER_ID = 'emoji-hunt-layer';

/** @type {Map<string, HTMLElement>} */
const active = new Map();

let started = false;
let unsubRealtime = null;

export function startEmojiHuntOverlay() {
  if (started) return;
  started = true;

  // Cleanup any orphaned nodes
  const layer = document.getElementById(LAYER_ID);
  if (!layer) return;
  layer.replaceChildren();
  layer.style.pointerEvents = 'none';

  // Initial fetch
  listActiveHunts()
    .then((rows) => rows.forEach(spawn))
    .catch((e) => logger.warn('hunt initial fetch failed', e));

  unsubRealtime = subscribeToHunts({
    onSpawn: spawn,
    onClaim: (row) => {
      if (row.found_by) despawn(row.id);
    },
  });

  // GC expired client-side
  setInterval(() => {
    const now = Date.now();
    for (const [id, el] of active) {
      const exp = Number(el.dataset.expiresAt);
      if (exp <= now) despawn(id);
    }
  }, 1000);
}

export function stopEmojiHuntOverlay() {
  unsubRealtime?.();
  started = false;
}

function spawn(row) {
  if (!row || row.found_by) return;
  if (active.has(row.id)) return;
  if (new Date(row.expires_at).getTime() <= Date.now()) return;

  const layer = document.getElementById(LAYER_ID);
  if (!layer) return;

  const node = document.createElement('span');
  node.className = 'hunt-emoji';
  node.textContent = row.emoji;
  node.dataset.expiresAt = String(new Date(row.expires_at).getTime());
  node.style.left = clamp(row.position_x * 100, 2, 95) + '%';
  node.style.top = clamp(row.position_y * 100, 8, 90) + '%';

  // gentle floating
  node.animate(
    [
      { transform: 'translate(0,0) rotate(0deg)' },
      { transform: 'translate(8px,-12px) rotate(8deg)' },
      { transform: 'translate(-6px,6px) rotate(-6deg)' },
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
      // someone else got there first, or hunt expired
      toastError(err.message ?? 'Already claimed');
    } finally {
      despawn(row.id);
    }
  });

  layer.appendChild(node);
  active.set(row.id, node);
}

function despawn(id) {
  const el = active.get(id);
  if (!el) return;
  el.remove();
  active.delete(id);
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

// React to logout: clear the overlay.
userStore.subscribe(({ user }) => {
  if (!user) {
    for (const id of [...active.keys()]) despawn(id);
  }
});
