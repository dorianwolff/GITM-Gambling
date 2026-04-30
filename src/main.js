/**
 * main.js
 * App entry point.
 *
 * Boot order:
 *   1. Import global styles (Tailwind).
 *   2. Initialise the auth session — this populates userStore.
 *   3. Mount the router.
 *   4. Start the ambient emoji-hunt overlay once we have a user.
 *   5. Subscribe to the user's own profile row so credit changes from
 *      ANY tab (game, event, claim, hunt) reflect everywhere live.
 */
import './styles/main.css';

import { initSession } from './auth/session.js';
import { createRouter } from './router/router.js';
import { routes } from './router/routes.js';
import { userStore } from './state/user-store.js';
import { subscribeToOwnProfile } from './services/profile-service.js';
import { startEmojiHuntOverlay, stopEmojiHuntOverlay } from './games/emoji-hunt/ambient-overlay.js';
import { setProfile } from './state/user-store.js';
import { ROUTES } from './config/constants.js';
import { logger } from './lib/logger.js';
import { startConnectionWatchdog, refreshNow } from './lib/connection-watchdog.js';

const app = document.getElementById('app');
const router = createRouter(routes);

// Bootstrap the session BEFORE mounting the router so that route guards see
// the resolved auth state on the very first render and don't flicker.
initSession()
  .catch((e) => logger.error('initSession failed', e))
  .finally(() => {
    router.start(app);
    // Start the watchdog after the router so it can hook into route events
    // and after auth so the first resync sees a real session.
    startConnectionWatchdog();
  });

// Live-mirror profile changes (credits, streak, etc.) into userStore.
// We tear down + recreate the realtime subscription whenever the user id
// changes (login/logout) AND whenever the watchdog asks for a reconnect
// (custom 'gitm:realtime-reconnect' event), so that a dead websocket
// after laptop sleep doesn't silently freeze the credit display.
let profileSub = null;
let lastUserId = null;

function ensureProfileSub(userId) {
  // Already subscribed for this user — leave it alone.
  if (profileSub && lastUserId === userId) return;
  profileSub?.();
  profileSub = userId ? subscribeToOwnProfile(userId, (row) => setProfile(row)) : null;
  lastUserId = userId;
}

userStore.subscribe(({ user }) => {
  const id = user?.id ?? null;
  if (id === lastUserId && (id == null || profileSub)) return;

  if (id) {
    ensureProfileSub(id);
    startEmojiHuntOverlay();
  } else {
    profileSub?.();
    profileSub = null;
    lastUserId = null;
    stopEmojiHuntOverlay();
    const path = window.location.pathname;
    if (path !== ROUTES.LOGIN && path !== ROUTES.AUTH_CALLBACK) {
      router.navigate(ROUTES.LOGIN, { replace: true });
    }
  }
});

// When the watchdog forces a realtime reconnect, also recycle our profile
// channel — Supabase will resubscribe with a fresh token.
window.addEventListener('gitm:realtime-reconnect', () => {
  const id = userStore.get().user?.id ?? null;
  if (!id) return;
  profileSub?.();
  profileSub = subscribeToOwnProfile(id, (row) => setProfile(row));
});

// Expose the manual resync for debugging from the devtools console.
if (import.meta.env?.DEV) window.__gitmRefresh = refreshNow;

// Friendly global error boundary
window.addEventListener('unhandledrejection', (e) => {
  logger.error('unhandled rejection', e.reason);
});
