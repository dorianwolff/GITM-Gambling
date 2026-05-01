/**
 * supabase.js
 * Single Supabase client instance for the whole app.
 * Only the public ANON key is shipped to the browser; all sensitive logic
 * (credit mutations, game resolution) lives in Postgres functions with RLS.
 *
 * --- Tab-switch hang hardening (v3) --------------------------------------
 * @supabase/supabase-js v2 uses `navigator.locks` to serialise auth session
 * reads/writes. That lock can get stuck across tab hides/sleeps/BFCache
 * resumes — the classic symptom is "after alt-tabbing away and back every
 * RPC hangs forever because `supabase.auth.getSession()` never resolves".
 *
 * Two independent safety nets:
 *
 *   1. `lock`: replace the default navigator.locks-based lock with a no-op.
 *      The server handles concurrent refresh requests idempotently, so the
 *      worst case of losing the lock is one extra refresh round-trip in a
 *      very rare race — infinitely preferable to the UI going dead.
 *
 *   2. `global.fetch`: wrap every outgoing request in an AbortController
 *      with a hard timeout. If *anything* hangs (dead socket, stuck auth,
 *      frozen DNS) the promise rejects and the user sees a toast instead
 *      of a permanently-disabled "Play" button.
 *
 * These two together mean the app can always recover without a page reload.
 */

import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

// --- AbortController helper: combine multiple signals into one. ----------
function anySignal(signals) {
  const ctrl = new AbortController();
  for (const s of signals) {
    if (!s) continue;
    if (s.aborted) { ctrl.abort(s.reason); break; }
    s.addEventListener('abort', () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl.signal;
}

// 20 s covers slow cold-start Postgres functions on the Supabase free tier
// but is well below the "user thinks it's broken forever" threshold.
const FETCH_TIMEOUT_MS = 20_000;

function fetchWithTimeout(input, init = {}) {
  const ctrl = new AbortController();
  const id = setTimeout(() => {
    try { ctrl.abort(new DOMException('Request timed out', 'TimeoutError')); }
    catch { ctrl.abort(); }
  }, FETCH_TIMEOUT_MS);

  const signal = init.signal ? anySignal([init.signal, ctrl.signal]) : ctrl.signal;
  return fetch(input, { ...init, signal }).finally(() => clearTimeout(id));
}

// No-op lock — always grants immediately. Bypasses navigator.locks entirely
// so a lock that wasn't released during tab-hidden state can never deadlock
// the auth subsystem.
async function noopLock(_name, _timeout, fn) {
  return fn();
}

export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    lock: noopLock,
  },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
  global: {
    fetch: fetchWithTimeout,
  },
});
