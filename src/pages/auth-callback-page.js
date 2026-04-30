/**
 * auth-callback-page.js
 * Lands here after Microsoft OAuth. Supabase parses the URL fragment in the
 * background; we just wait for a session and bounce.
 */
import { h } from '../utils/dom.js';
import { supabase } from '../lib/supabase.js';
import { ROUTES } from '../config/constants.js';
import { spinner } from '../ui/components/spinner.js';

export async function renderAuthCallback(ctx) {
  // Give Supabase a tick to consume the OAuth fragment.
  for (let i = 0; i < 30; i++) {
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      ctx.navigate(ROUTES.DASHBOARD, { replace: true });
      return null;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  ctx.navigate(ROUTES.LOGIN, { replace: true });
  return h('div.min-h-screen.grid.place-items-center', {}, [
    h('div.flex.items-center.gap-3.text-muted', {}, [spinner(), 'Signing you in…']),
  ]);
}
