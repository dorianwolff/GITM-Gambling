/**
 * game-rotation.js
 * Reads the active 6-game rotation from the server. The DB function
 * `get_active_games()` rotates the table lazily on every call, so simply
 * fetching is enough to keep the rotation moving forward.
 *
 * The result is cached for a short window so the games-hub and the per-page
 * route guard don't refetch on every navigation. Cache invalidates whenever
 * any active game's `ends_at` is past.
 */
import { supabase } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';

// Map game-id (db) → application route (constants).
import { ROUTES } from '../config/constants.js';
export const GAME_ID_TO_ROUTE = Object.freeze({
  coinflip:  ROUTES.COINFLIP,
  dice:      ROUTES.DICE,
  roulette:  ROUTES.ROULETTE,
  blackjack: ROUTES.BLACKJACK,
  crash:     ROUTES.CRASH,
  cases:     ROUTES.CASE,
  gacha:     ROUTES.GACHA,
  mines:     ROUTES.MINES,
  candy:     ROUTES.CANDY,
});

// Reverse lookup: route → game id, used by the route guard.
export const ROUTE_TO_GAME_ID = Object.freeze(
  Object.fromEntries(Object.entries(GAME_ID_TO_ROUTE).map(([k, v]) => [v, k]))
);

const CACHE_TTL_MS = 60_000; // refresh at most once a minute

let cache = null;          // { fetchedAt, expiresEarliest, rows }
let inflight = null;

export async function getActiveGames({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache && now - cache.fetchedAt < CACHE_TTL_MS && now < cache.expiresEarliest) {
    return cache.rows;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const { data, error } = await supabase.rpc('get_active_games');
      if (error) throw error;
      const rows = (data ?? []).map((r) => ({
        gameId:   r.game_id,
        startedAt: new Date(r.started_at),
        endsAt:    new Date(r.ends_at),
      }));
      const earliest = rows.reduce((a, r) => Math.min(a, r.endsAt.getTime()), Infinity);
      cache = { fetchedAt: now, expiresEarliest: earliest, rows };
      return rows;
    } catch (e) {
      logger.warn('rotation fetch failed', e);
      // Fall back to the previous cache if any, else return an empty list
      // so the UI degrades to "all games available" rather than locking
      // the user out on a transient backend hiccup.
      return cache?.rows ?? [];
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * True if the game id is currently in rotation. If the rotation list isn't
 * loaded yet (cold start, no network), returns true defensively so we
 * never hard-block users on a transient failure.
 */
export async function isGameActive(gameId) {
  const rows = await getActiveGames();
  if (!rows.length) return true;
  return rows.some((r) => r.gameId === gameId && r.endsAt.getTime() > Date.now());
}

export function clearRotationCache() {
  cache = null;
}
