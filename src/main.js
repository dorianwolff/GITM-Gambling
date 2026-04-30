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

const app = document.getElementById('app');
const router = createRouter(routes);

// Bootstrap the session BEFORE mounting the router so that route guards see
// the resolved auth state on the very first render and don't flicker.
initSession()
  .catch((e) => logger.error('initSession failed', e))
  .finally(() => router.start(app));

// Live-mirror profile changes (credits, streak, etc.) into userStore.
let profileSub = null;
let lastUserId = null;
userStore.subscribe(({ user }) => {
  if (user?.id === lastUserId) return;
  lastUserId = user?.id ?? null;

  // tear down previous subscription
  profileSub?.();
  profileSub = null;

  if (user?.id) {
    profileSub = subscribeToOwnProfile(user.id, (row) => setProfile(row));
    startEmojiHuntOverlay();
  } else {
    stopEmojiHuntOverlay();
    // If we're not on a public route and we just lost auth, bounce.
    const path = window.location.pathname;
    if (path !== ROUTES.LOGIN && path !== ROUTES.AUTH_CALLBACK) {
      router.navigate(ROUTES.LOGIN, { replace: true });
    }
  }
});

// Friendly global error boundary
window.addEventListener('unhandledrejection', (e) => {
  logger.error('unhandled rejection', e.reason);
});
