/**
 * auth-guard.js
 * Route guards. Wraps a render function and enforces auth/admin requirements
 * and the per-route game-rotation lock-out.
 */
import { userStore, isAdmin } from '../state/user-store.js';
import { ROUTES } from '../config/constants.js';
import { isGameActive } from '../services/game-rotation.js';
import { toastError } from '../ui/components/toast.js';

export function requireAuth(render) {
  return (ctx) => {
    const { user, loading } = userStore.get();
    if (loading) return { html: '<div class="p-10 text-muted">Loading…</div>' };
    if (!user) {
      ctx.navigate(ROUTES.LOGIN, { replace: true });
      return null;
    }
    return render(ctx);
  };
}

export function requireAdmin(render) {
  return requireAuth((ctx) => {
    const { profile } = userStore.get();
    if (!profile?.is_admin) {
      ctx.navigate(ROUTES.DASHBOARD, { replace: true });
      return null;
    }
    return render(ctx);
  });
}

/**
 * Lock the user out of a game route while it is not in the current 6-game
 * rotation. We use `replaceState` so the browser back-button cannot send
 * them back into the rotated-out page — once a game is gone, it's gone.
 *
 * `gameId` is the rotation id (e.g. 'coinflip', 'gacha'), NOT the path.
 *
 * Soft policy: while the rotation list is still loading we let the user
 * through. The DB function pre-rotates on every read so the freshest
 * answer is one network round-trip away; we don't want to flash the
 * "rotated out" toast on a transient hiccup. If they were mid-game on
 * this route, the inner page is already mounted — they get to finish.
 */
export function requireActiveGame(gameId, render) {
  return requireAuth(async (ctx) => {
    // Admins bypass the rotation lock entirely (mirrors the server-side
    // bypass in v10's is_game_active). Lets us test/play any game any time.
    if (isAdmin()) return render(ctx);
    const active = await isGameActive(gameId).catch(() => true);
    if (!active) {
      // Hard-replace so the browser's history doesn't preserve this route.
      // Using replaceState directly bypasses any pushState the user may
      // have just done, so even Back can't come here again.
      try {
        history.replaceState({}, '', ROUTES.GAMES);
      } catch { /* ignore */ }
      // Defer toast + render to next microtask: the navigate below will
      // re-trigger render, and we don't want both runs to mount a page.
      queueMicrotask(() => {
        toastError(`${prettyGameName(gameId)} is currently out of rotation. It will be back soon.`);
        ctx.navigate(ROUTES.GAMES, { replace: true });
      });
      return null;
    }
    return render(ctx);
  });
}

function prettyGameName(id) {
  switch (id) {
    case 'coinflip':  return 'Coinflip';
    case 'dice':      return 'Dice';
    case 'roulette':  return 'Roulette';
    case 'blackjack': return 'Blackjack';
    case 'crash':     return 'Crash';
    case 'cases':     return 'Cases';
    case 'gacha':     return 'Gacha';
    default:          return id;
  }
}

export function redirectIfAuthed(render) {
  return (ctx) => {
    const { user, loading } = userStore.get();
    if (loading) return null;
    if (user) {
      ctx.navigate(ROUTES.DASHBOARD, { replace: true });
      return null;
    }
    return render(ctx);
  };
}
