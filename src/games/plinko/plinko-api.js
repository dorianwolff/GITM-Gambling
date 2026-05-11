/**
 * plinko-api.js
 * Thin wrapper around play_plinko RPC.
 */
import { supabase } from '../../lib/supabase.js';

export const PLINKO_ROWS = [8, 10, 12];
export const PLINKO_RISKS = ['low', 'medium', 'high'];

/**
 * Multiplier tables by row count (must match SQL plinko_mult table after
 * v20). Tuned for ~97% RTP per binomial distribution:
 *   8 rows  : low 97.0% / med 97.0% / high 97.0%
 *   10 rows : low 97.0% / med 97.0% / high 97.0%
 *   12 rows : low 97.0% / med 97.0% / high 97.0%
 */
export const PLINKO_MULTS = Object.freeze({
  8: {
    low:    [5.49, 2.06, 1.08, 0.98, 0.49, 0.98, 1.08, 2.06, 5.49],
    medium: [12.75, 2.94, 1.28, 0.69, 0.39, 0.69, 1.28, 2.94, 12.75],
    high:   [28.39, 3.92, 1.47, 0.29, 0.2, 0.29, 1.47, 3.92, 28.39],
  },
  10: {
    low:    [8.72, 2.94, 1.37, 1.08, 0.98, 0.49, 0.98, 1.08, 1.37, 2.94, 8.72],
    medium: [21.58, 4.9, 1.96, 1.37, 0.59, 0.39, 0.59, 1.37, 1.96, 4.9, 21.58],
    high:   [74.84, 9.85, 3.94, 0.49, 0.3, 0.2, 0.3, 0.49, 3.94, 9.85, 74.84],
  },
  12: {
    low:    [10.02, 3.01, 1.6, 1.2, 1.1, 1.0, 0.5, 1.0, 1.1, 1.2, 1.6, 3.01, 10.02],
    medium: [33.14, 11.05, 4.02, 2.01, 1.0, 0.6, 0.3, 0.6, 1.0, 2.01, 4.02, 11.05, 33.14],
    high:   [168.09, 23.73, 8.01, 1.98, 0.49, 0.3, 0.2, 0.3, 0.49, 1.98, 8.01, 23.73, 168.09],
  },
});

export const PLINKO_COLORS = Object.freeze({
  8: {
    low:    ['#22c2ff', '#3ddc7e', '#8a8f99', '#8a8f99', '#ff3370', '#8a8f99', '#8a8f99', '#3ddc7e', '#22c2ff'],
    medium: ['#b06bff', '#22c2ff', '#3ddc7e', '#8a8f99', '#ff3370', '#8a8f99', '#3ddc7e', '#22c2ff', '#b06bff'],
    high:   ['#ffd96b', '#b06bff', '#22c2ff', '#3ddc7e', '#ff3370', '#3ddc7e', '#22c2ff', '#b06bff', '#ffd96b'],
  },
  10: {
    low:    ['#22c2ff', '#3ddc7e', '#8a8f99', '#8a8f99', '#8a8f99', '#ff3370', '#8a8f99', '#8a8f99', '#8a8f99', '#3ddc7e', '#22c2ff'],
    medium: ['#b06bff', '#22c2ff', '#3ddc7e', '#8a8f99', '#8a8f99', '#ff3370', '#8a8f99', '#8a8f99', '#3ddc7e', '#22c2ff', '#b06bff'],
    high:   ['#ffd96b', '#b06bff', '#22c2ff', '#3ddc7e', '#8a8f99', '#ff3370', '#8a8f99', '#3ddc7e', '#22c2ff', '#b06bff', '#ffd96b'],
  },
  12: {
    low:    ['#22c2ff', '#3ddc7e', '#8a8f99', '#8a8f99', '#8a8f99', '#8a8f99', '#ff3370', '#8a8f99', '#8a8f99', '#8a8f99', '#8a8f99', '#3ddc7e', '#22c2ff'],
    medium: ['#b06bff', '#22c2ff', '#3ddc7e', '#8a8f99', '#8a8f99', '#8a8f99', '#ff3370', '#8a8f99', '#8a8f99', '#8a8f99', '#3ddc7e', '#22c2ff', '#b06bff'],
    high:   ['#ffd96b', '#b06bff', '#22c2ff', '#3ddc7e', '#8a8f99', '#8a8f99', '#ff3370', '#8a8f99', '#8a8f99', '#3ddc7e', '#22c2ff', '#b06bff', '#ffd96b'],
  },
});

export function getPlinkoMults(rows, risk) {
  return PLINKO_MULTS[rows]?.[risk] ?? PLINKO_MULTS[8][risk];
}
export function getPlinkoColors(rows, risk) {
  return PLINKO_COLORS[rows]?.[risk] ?? PLINKO_COLORS[8][risk];
}

export async function playPlinko(bet, rows, risk) {
  const { data, error } = await supabase.rpc('play_plinko', {
    p_bet: bet,
    p_rows: rows,
    p_risk: risk,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    newBalance: row.new_balance,
    path: row.path ?? [],
    binIndex: row.bin_index,
    multiplier: Number(row.multiplier),
    payout: row.payout,
    won: row.won,
  };
}

/** Allowed multi-ball sizes — kept in sync with SQL `play_plinko_batch`. */
export const PLINKO_BATCH_SIZES = [1, 5, 10, 25, 50];

/**
 * Start a plinko batch by debiting the wager and reserving a batch id.
 * The balls are animated client-side and settled later with the actual
 * landing bins so rewards are based on where they really land.
 */
export async function playPlinkoBatch(bet, rows, risk, count) {
  const { data, error } = await supabase.rpc('play_plinko_batch', {
    p_bet: bet,
    p_rows: rows,
    p_risk: risk,
    p_count: count,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    batchId: row?.batch_id,
    newBalance: row?.new_balance,
  };
}

/**
 * Settle a plinko batch once all of its balls have landed.
 * `bins` must be the actual landing bins in drop order.
 */
export async function settlePlinkoBatch(batchId, bins) {
  const { data, error } = await supabase.rpc('settle_plinko_batch', {
    p_batch_id: batchId,
    p_bins: bins,
  });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    idx:        r.idx,
    binIndex:   r.bin_index,
    multiplier: Number(r.multiplier),
    payout:     r.payout,
    won:        r.won,
    newBalance: r.new_balance,
  }));
}
