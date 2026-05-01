/**
 * leaderboard.js
 *
 * Every board is just a lightweight view over the `profiles` table with an
 * index on the sort column — so each fetch is an O(log N) btree scan and
 * the free Supabase tier is happy. No materialised views, no cron jobs.
 *
 * All views expose the same row shape:
 *   { id, display_name, avatar_url, value, ...secondary-metrics }
 * so the UI can render them with one component.
 */
import { supabase } from '../lib/supabase.js';

/**
 * Leaderboard metadata — maps a board id to the view, value label, and
 * the suffix shown after the number ('cr', 'items', 'cases', ...). The
 * order here is also the order in which tabs appear in the UI.
 */
export const LEADERBOARDS = [
  {
    id:       'credits',
    label:    'Current credits',
    blurb:    'Live balance — the classic leaderboard.',
    view:     'v_leaderboard',
    valueKey: 'credits',
    suffix:   'cr',
    accent:   '#22e1ff',
    icon:     '💰',
  },
  {
    id:       'peak',
    label:    'Peak credits',
    blurb:    'Highest balance anyone has ever hit. Whales only.',
    view:     'v_lb_peak',
    valueKey: 'value',
    suffix:   'cr',
    accent:   '#ffd96b',
    icon:     '📈',
  },
  {
    id:       'biggest',
    label:    'Biggest single win',
    blurb:    'One moment, one bet — the biggest payout of their life.',
    view:     'v_lb_biggest_win',
    valueKey: 'value',
    suffix:   'cr',
    accent:   '#ff9a2e',
    icon:     '🎯',
  },
  {
    id:       'won',
    label:    'Total won',
    blurb:    'Lifetime profit from all payouts combined.',
    view:     'v_lb_total_won',
    valueKey: 'value',
    suffix:   'cr',
    accent:   '#3ddc7e',
    icon:     '🏆',
  },
  {
    id:       'wagered',
    label:    'Total wagered',
    blurb:    'Nobody bets more. Whether that is good or bad is on them.',
    view:     'v_lb_total_wagered',
    valueKey: 'value',
    suffix:   'cr',
    accent:   '#b06bff',
    icon:     '🎰',
  },
  {
    id:       'cases',
    label:    'Cases opened',
    blurb:    'Keep pulling. The drops will come.',
    view:     'v_lb_cases',
    valueKey: 'value',
    suffix:   'cases',
    accent:   '#ff2bd6',
    icon:     '📦',
  },
  {
    id:       'collection',
    label:    'Collection size',
    blurb:    'Unique cosmetics owned. Duplicates don\'t count.',
    view:     'v_lb_collection',
    valueKey: 'value',
    suffix:   'items',
    accent:   '#22c2ff',
    icon:     '🗃️',
  },
];

export function boardById(id) {
  return LEADERBOARDS.find((b) => b.id === id) ?? LEADERBOARDS[0];
}

/**
 * Fetch a specific leaderboard. Falls back to `credits` if the id is unknown.
 */
export async function getLeaderboardByType(boardId, limit = 50) {
  const board = boardById(boardId);
  const { data, error } = await supabase
    .from(board.view)
    .select('*')
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r, i) => ({
    ...r,
    rank: i + 1,
    value: r[board.valueKey] ?? 0,
    _board: board,
  }));
}

/**
 * Back-compat: the credits leaderboard (used by the original page).
 */
export async function getLeaderboard(limit = 50) {
  return getLeaderboardByType('credits', limit);
}
