/**
 * connection-watchdog.js
 *
 * Every previous version of this module attempted to "help" tab-wake
 * recovery by cycling the realtime socket, refetching the profile, and
 * dispatching remount events on every visibilitychange / focus / route
 * change. The result was a thundering herd the moment the tab came back:
 * a socket disconnect + reconnect, a profile fetch, and — because the
 * router also listened for the `tab-wake` event — a full page remount
 * that fired its own data fetches. Every one of those requests went
 * through the Supabase auth lock. Any single slow request blocked all
 * the others, and the user's next click then queued behind the whole
 * backlog. That is the "click Play after tab switch, nothing happens"
 * bug.
 *
 * The right answer is simple: do nothing on tab switch. The Supabase
 * client already handles its own token refresh, and the Phoenix realtime
 * client already handles its own heartbeat and reconnect. Any help we
 * added on top was net-negative.
 *
 * This module is kept only as a set of exported no-ops so existing
 * call-sites (main.js) and `window.__gitmRefresh` don't break. It can
 * be deleted entirely once the imports are removed.
 */

export function startConnectionWatchdog() {
  // Intentionally empty. See file header.
}

export function stopConnectionWatchdog() {
  // Intentionally empty.
}

export async function refreshNow(/* reason */) {
  // Intentionally empty.
}

export async function hardReconnect(/* reason */) {
  // Intentionally empty.
}
