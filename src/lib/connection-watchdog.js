/**
 * connection-watchdog.js
 * Keeps the Supabase session and realtime connection healthy across:
 *   - tab focus / visibility changes (laptop sleep, alt-tab, etc.)
 *   - network online events (wifi flap)
 *   - long-running idle (periodic poll)
 *   - SPA route changes (cheap belt-and-suspenders profile resync)
 *
 * -------------------- v3 architectural note -----------------------------
 *
 * Previous versions called `supabase.auth.refreshSession()` on every
 * visibilitychange. That turned out to be the cause of the "tab-switch
 * makes every game hang forever" bug: we were fighting the built-in
 * `autoRefreshToken` handler for the same navigator.locks-guarded auth
 * state and creating deadlocks that left `getSession()` — and therefore
 * every RPC — waiting forever on a lock that would never release.
 *
 * The root cause is now fixed structurally in `supabase.js` via a no-op
 * lock + global fetch timeout. This watchdog no longer touches auth.
 *
 * v3 responsibilities:
 *   1. Cycle the realtime websocket on tab wake / network wake. The
 *      websocket can silently die while the tab is hidden — the fetch-
 *      based RPCs will recover on their own, but realtime subscriptions
 *      need a deliberate kick.
 *   2. Refetch the profile after long idle so the credits number is
 *      consistent with the server before the user places their next bet.
 *   3. Tell page-level subscribers to rebuild their channels via a custom
 *      event, so pages that have live updates get a clean re-join.
 *
 * It deliberately does NOT:
 *   - Call `auth.refreshSession()` / `auth.getSession()` on wake. The
 *     supabase-js client already handles this correctly on its own and
 *     double-driving it is what caused the original hang.
 *   - Block the tab-wake path on anything that can fail. Every call is
 *     wrapped so a broken step never stops later steps.
 *
 * Public API:
 *   startConnectionWatchdog()
 *   refreshNow(reason?)     — soft: refetch profile, cycle socket if dead
 *   hardReconnect(reason?)  — force a websocket cycle + profile refetch
 */
import { supabase } from './supabase.js';
import { logger } from './logger.js';
import { userStore, setProfile } from '../state/user-store.js';
import { refreshProfile } from '../services/profile-service.js';

let started = false;
let lastRun = 0;
let periodicId = null;
let hiddenAt = 0;       // ms timestamp of the last visibilitychange→hidden

const DEDUPE_MS = 1500;
const PERIODIC_RESYNC_MS = 4 * 60_000;
// Only force-cycle the websocket if the tab was hidden longer than this.
// Anything shorter and Phoenix's own heartbeat keeps the socket alive
// without us doing anything — cycling on every brief alt-tab just creates
// a flood of WSS reconnects and `__cf_bm` cookie warnings in the console.
const HIDDEN_THRESHOLD_MS = 60_000;

/**
 * Soft resync. Refetch profile; cycle socket only if it reports dead.
 * Cheap — safe to spam on route changes.
 */
export async function refreshNow(reason = 'manual') {
  const now = Date.now();
  if (now - lastRun < DEDUPE_MS) return;
  lastRun = now;

  const uid = userStore.get().user?.id;
  if (!uid) return;

  // Fire-and-forget profile refetch. Don't await — if the network stalls
  // we don't want this to block the rest of the wake path.
  refreshProfile(uid)
    .then((p) => p && setProfile(p))
    .catch((e) => logger.warn('watchdog: profile refetch failed', e));

  // Only cycle if clearly dead; otherwise trust the built-in heartbeat.
  try {
    const rt = supabase.realtime;
    const isOpen = typeof rt?.isConnected === 'function' ? rt.isConnected() : true;
    if (!isOpen) cycleSocket('soft-dead');
  } catch (e) { logger.warn('watchdog: realtime probe failed', e); }

  logger.debug('watchdog: soft resync', { reason });
}

/**
 * Hard reconnect: always cycle the websocket + refetch profile. Used when
 * we know the tab was hidden / the network flapped and passive recovery
 * probably isn't enough.
 *
 * Still zero auth calls. The client auto-refreshes its own token on a
 * timer and the no-op lock means no RPC can ever deadlock on `getSession`.
 */
export async function hardReconnect(reason = 'manual') {
  const now = Date.now();
  if (now - lastRun < DEDUPE_MS) return;
  lastRun = now;

  const uid = userStore.get().user?.id;
  if (!uid) return;

  cycleSocket(reason);

  // Refetch profile non-blocking.
  refreshProfile(uid)
    .then((p) => p && setProfile(p))
    .catch((e) => logger.warn('watchdog[hard]: profile refetch failed', e));

  logger.debug('watchdog: hard resync', { reason });
}

/**
 * Disconnect and reconnect the realtime socket. Every subscribed channel
 * re-joins on its own. Pages with page-scoped channels also receive the
 * `gitm:realtime-reconnect` custom event so they can rebuild if needed.
 *
 * All defensive — never throws.
 */
function cycleSocket(reason) {
  try {
    const rt = supabase.realtime;
    if (!rt) return;
    try { rt.disconnect?.(); } catch {}
    // One tick so `connect()` doesn't race `disconnect()` internal state.
    setTimeout(() => {
      try { rt.connect?.(); } catch (e) { logger.warn('watchdog: connect threw', e); }
      window.dispatchEvent(new CustomEvent('gitm:realtime-reconnect', {
        detail: { reason },
      }));
    }, 50);
  } catch (e) {
    logger.warn('watchdog: cycle threw', e);
  }
}

export function startConnectionWatchdog() {
  if (started) return;
  started = true;

  // Visibility transitions. We only act on returning-to-visible, and only
  // hard-cycle the socket when the tab was hidden long enough that Phoenix's
  // own heartbeat may have lapsed. Brief alt-tabs leave the socket alone
  // (it is fine, Phoenix will keep it alive) so the console isn't flooded
  // with new WSS connects every time the user glances at another tab.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      return;
    }
    if (document.visibilityState !== 'visible') return;

    const hiddenFor = hiddenAt > 0 ? Date.now() - hiddenAt : 0;
    hiddenAt = 0;

    if (hiddenFor >= HIDDEN_THRESHOLD_MS) {
      // Long hide → socket likely dead, kick the page to remount too.
      hardReconnect('visibility-long');
      window.dispatchEvent(new CustomEvent('gitm:tab-wake', {
        detail: { reason: 'visibility-long', hiddenFor },
      }));
    } else {
      // Short hide → cheap profile refetch; only cycle if the socket
      // self-reports dead (refreshNow checks before cycling).
      refreshNow('visibility-short');
    }
  });

  // Window focus on macOS fires without visibilitychange when alt-tabbing
  // between app windows. Treat as a *soft* nudge only — never cycle.
  window.addEventListener('focus', () => refreshNow('focus'));

  // Network back online — the socket is definitely toast, force a cycle.
  window.addEventListener('online', () => hardReconnect('online'));

  // BFCache restore — page resumed from memory, socket is gone for sure.
  window.addEventListener('pageshow', (ev) => {
    if (ev.persisted) {
      hardReconnect('pageshow-bfcache');
      window.dispatchEvent(new CustomEvent('gitm:tab-wake', { detail: { reason: 'bfcache' } }));
    }
  });

  // SPA route change → cheap soft resync.
  window.addEventListener('gitm:route', () => refreshNow('route'));

  // Periodic safety net.
  periodicId = setInterval(() => refreshNow('periodic'), PERIODIC_RESYNC_MS);
}

export function stopConnectionWatchdog() {
  if (!started) return;
  if (periodicId) clearInterval(periodicId);
  periodicId = null;
  started = false;
}
