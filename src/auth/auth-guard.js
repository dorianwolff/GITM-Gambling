/**
 * auth-guard.js
 * Route guards. Wraps a render function and enforces auth/admin requirements.
 */
import { userStore } from '../state/user-store.js';
import { ROUTES } from '../config/constants.js';

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
