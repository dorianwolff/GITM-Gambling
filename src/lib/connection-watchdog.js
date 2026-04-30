/**
 * connection-watchdog.js
 * Keeps the Supabase session and realtime connection healthy across:
 *   - tab focus / visibility changes (laptop sleep, alt-tab, etc.)
 *   - network online events (wifi flap)
 *   - long-running idle (periodic poll)
 *   - SPA route changes (cheap belt-and-suspenders profile resync)
 *
 * Why this exists:
 *   Supabase's auto-refresh token pauses while the tab is hidden, so an
 *   inactive tab can wake up with an expired JWT and start failing RPCs
 *   ("JWT expired" 401) until the user reloads.
 *   Likewise the realtime websocket drops silently after long idle; the
 *   profile/events/hunts channels go quiet and the UI shows stale data
 *   until reload.
 *   This module forces a recovery on every wake/online/route event.
 *
 * Public API:
 *   startConnectionWatchdog()  — call once at app boot, after auth init.
 *   refreshNow()               — manually force a resync (e.g. after an
 *                                action you suspect raced with the socket).
 */
import { supabase } from './supabase.js';
import { logger } from './logger.js';
import { userStore, setUser, setProfile } from '../state/user-store.js';
import { refreshProfile } from '../services/profile-service.js';

let started = false;
let lastSync = 0;
let periodicId = null;

const RESYNC_DEDUPE_MS = 1500;          // collapse rapid-fire calls
const PERIODIC_RESYNC_MS = 4 * 60_000;  // 4 minutes — well below 1h JWT TTL

/**
 * Force a full session + profile + realtime resync.
 * Cheap: ~1 round trip when nothing is stale, ~3 when JWT needs refresh.
 */
export async function refreshNow(reason = 'manual') {
  const now = Date.now();
  if (now - lastSync < RESYNC_DEDUPE_MS) return;
  lastSync = now;

  try {
    // 1. Pull the cached session, then force-refresh the JWT if it has
    //    expired or is about to. `getSession()` does NOT refresh on its
    //    own (it reads from local storage); we have to call
    //    `refreshSession()` ourselves.
    let { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
      logger.warn('watchdog: getSession error', error);
      return;
    }
    if (session) {
      const expiresAt = (session.expires_at ?? 0) * 1000; // seconds → ms
      const remaining = expiresAt - Date.now();
      if (remaining < 60_000) {
        // Less than a minute left (or already expired) → refresh now.
        const refreshed = await supabase.auth.refreshSession();
        if (refreshed.error) {
          logger.warn('watchdog: refreshSession failed', refreshed.error);
          return;
        }
        session = refreshed.data.session;
      }
    }
    const user = session?.user ?? null;
    if (!user) return; // signed out — nothing to do

    // Always update the user reference so any code reading userStore
    // sees the freshest token-bound user object.
    if (userStore.get().user?.id !== user.id) {
      setUser(user);
    } else {
      // Same id but new session; userStore's user object can stay,
      // we just need its token-bound state to be current. Touching
      // setUser here forces subscribers (realtime sub recreator) to
      // re-evaluate, but only when the id actually changed — which it
      // won't on a token refresh, so we skip.
    }

    // 2. Re-fetch the profile row. Realtime might have missed an update
    //    while the socket was dead.
    try {
      const profile = await refreshProfile(user.id);
      setProfile(profile);
    } catch (e) {
      logger.warn('watchdog: profile refetch failed', e);
    }

    // 3. Nudge the realtime client to reconnect any dead channels.
    //    `realtime.connect()` is a no-op if already connected; if the
    //    socket is closed it will reopen.
    try {
      const rt = supabase.realtime;
      const isOpen = typeof rt?.isConnected === 'function' ? rt.isConnected() : true;
      if (!isOpen && typeof rt?.connect === 'function') {
        rt.connect();
        // Tell app code to recycle channels with a fresh token. Pages and
        // services listen for this and re-subscribe.
        window.dispatchEvent(new CustomEvent('gitm:realtime-reconnect'));
      }
    } catch (e) {
      logger.warn('watchdog: realtime reconnect failed', e);
    }

    logger.debug('watchdog: resynced', { reason });
  } catch (e) {
    logger.warn('watchdog: resync threw', e);
  }
}

export function startConnectionWatchdog() {
  if (started) return;
  started = true;

  // Tab visibility — fires when user returns to the tab.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshNow('visibility');
  });

  // Window focus — secondary trigger; some browsers fire focus without
  // visibilitychange (e.g. switching app windows on macOS).
  window.addEventListener('focus', () => refreshNow('focus'));

  // Network came back.
  window.addEventListener('online', () => refreshNow('online'));

  // SPA route change — cheap resync on every navigation. Dedupe makes
  // this near-free if the user navigates rapidly.
  window.addEventListener('gitm:route', () => refreshNow('route'));

  // Periodic safety net.
  periodicId = setInterval(() => refreshNow('periodic'), PERIODIC_RESYNC_MS);
}

export function stopConnectionWatchdog() {
  if (!started) return;
  if (periodicId) clearInterval(periodicId);
  periodicId = null;
  started = false;
  // Listeners are bound to window/document for the app's lifetime; we
  // don't bother removing them — there is at most one watchdog ever.
}
