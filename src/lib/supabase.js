/**
 * supabase.js
 * Single Supabase client instance for the whole app.
 *
 * ===========================================================================
 * THE TAB-SWITCH HANG — WHAT IT IS AND WHY IT HAPPENS
 * ===========================================================================
 *
 * Every `supabase.from(...)` and `supabase.rpc(...)` call ultimately calls
 * `supabase.auth.getSession()` under the hood (via the client's internal
 * `_getAccessToken`) to inject the Bearer token into the request header.
 *
 * `getSession()` is serialised through an internal "auth lock". The lock has
 * two separate gates:
 *
 *   1. The pluggable `lock` option (navigator.locks by default). We already
 *      neutralise this with `noopLock` below.
 *
 *   2. An internal boolean `lockAcquired` that supabase-js flips on *inside*
 *      the lock callback and doesn't reset until the callback's promise
 *      settles. While it is true, all other `getSession()` / `refreshSession`
 *      calls are pushed onto a `pendingInLock` queue and await the current
 *      holder's promise.
 *
 * When the tab returns to the foreground, supabase-js's own auto-refresh
 * fires a `POST /auth/v1/token?grant_type=refresh_token` request. In Firefox
 * on an HTTP/2 connection that is coalesced with a freshly-re-opened wss
 * (the "__cf_bm cookie rejected" flood in the console), that POST can stall
 * for a very long time without erroring. The `lockAcquired` flag stays true.
 * Every page that now tries to fetch anything — leaderboards, profile,
 * market, game state — is pushed onto `pendingInLock` and sits there
 * forever from the user's point of view, showing a spinning "Loading…".
 * A hard refresh constructs a fresh client, resetting the flag, and
 * everything works again until the next tab switch.
 *
 * ===========================================================================
 * THE FIX
 * ===========================================================================
 *
 * Routine reads don't need the lock. The session is already in memory (and
 * mirrored to localStorage). Reading it is a synchronous operation that
 * cannot race with anything in a sensible way — at worst we return an
 * access_token that is a few seconds stale, which the server will accept.
 *
 * We therefore replace `supabase.auth.getSession` with a tiny lock-free
 * implementation right after client construction. Token refresh, sign-in,
 * and sign-out still go through the original locked path (we don't touch
 * `refreshSession` / `signIn*` / `signOut`), so session writes remain
 * correctly serialised. But every page-level fetch now gets its auth header
 * without ever touching `_acquireLock`, which means an in-flight refresh
 * can never block a user click.
 *
 * The `noopLock` + `fetchWithTimeout` belts remain as a second line of
 * defence for the write paths.
 * ===========================================================================
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

// 12 s is long enough for a cold-start Postgres function on the free tier
// but short enough that a genuinely stuck request self-heals before the
// user reaches for Ctrl-R.
const FETCH_TIMEOUT_MS = 12_000;

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

// ---------------------------------------------------------------------------
// Lock-free `getSession` patch — the actual tab-switch-hang fix.
//
// The supabase-js localStorage key format is `sb-<ref>-auth-token`, where
// <ref> is the subdomain of SUPABASE_URL (e.g. `fhybzjjrlhqolbvnugxx`).
// We derive it once here so we don't depend on internal fields.
// ---------------------------------------------------------------------------
const SESSION_STORAGE_KEY = (() => {
  try {
    const host = new URL(env.SUPABASE_URL).hostname; // e.g. abc.supabase.co
    const ref = host.split('.')[0];
    return `sb-${ref}-auth-token`;
  } catch {
    return null;
  }
})();

function readPersistedSession() {
  if (!SESSION_STORAGE_KEY || typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // supabase-js persists either the session object directly, or
    // `{ currentSession, expiresAt }`. Handle both shapes defensively.
    if (parsed?.access_token) return parsed;
    if (parsed?.currentSession?.access_token) return parsed.currentSession;
    return null;
  } catch {
    return null;
  }
}

// Replace the locked getSession with a direct in-memory / storage read.
// This is intentional: we never await anything here, so the auth lock can
// never wedge a page fetch regardless of what the auto-refresh is doing.
const authClient = supabase.auth;
authClient.getSession = async function patchedGetSession() {
  // `this` may be undefined when called via the bound reference supabase-js
  // stashed in fetchWithAuth; fall back to `authClient`.
  const self = this || authClient;
  const inMem = self?.inMemorySession;
  const session =
    (inMem && inMem.access_token ? inMem : null) ||
    readPersistedSession();
  return { data: { session: session ?? null }, error: null };
};
