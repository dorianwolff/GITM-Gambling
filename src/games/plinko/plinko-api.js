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
// Multipliers match the plinko_mult DB table (v27).
// Tuned for ~93% RTP via binomial distribution — verified:
//   sum(C(n,k) * mult[k]) / 2^n ≈ 0.93 for every row×risk combination.
export const PLINKO_MULTS = Object.freeze({
  8: {
    low:    [5.25, 1.97, 1.03, 0.94, 0.47, 0.94, 1.03, 1.97, 5.25],
    medium: [12.25, 2.82, 1.23, 0.66, 0.37, 0.66, 1.23, 2.82, 12.25],
    high:   [27.3, 3.76, 1.41, 0.28, 0.19, 0.28, 1.41, 3.76, 27.3],
  },
  10: {
    low:    [8.34, 2.81, 1.31, 1.03, 0.94, 0.47, 0.94, 1.03, 1.31, 2.81, 8.34],
    medium: [20.7, 4.71, 1.88, 1.31, 0.57, 0.37, 0.57, 1.31, 1.88, 4.71, 20.7],
    high:   [71.6, 9.43, 3.77, 0.47, 0.29, 0.19, 0.29, 0.47, 3.77, 9.43, 71.6],
  },
  12: {
    low:    [9.62, 2.89, 1.54, 1.15, 1.06, 0.96, 0.48, 0.96, 1.06, 1.15, 1.54, 2.89, 9.62],
    medium: [31.85, 10.62, 3.86, 1.93, 0.96, 0.58, 0.29, 0.58, 0.96, 1.93, 3.86, 10.62, 31.85],
    high:   [160.9, 22.71, 7.67, 1.90, 0.47, 0.29, 0.19, 0.29, 0.47, 1.90, 7.67, 22.71, 160.9],
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
    batchId:    row?.batch_id,
    newBalance: row?.new_balance,
    // paths: boolean[][] — one L/R sequence per ball, from server RNG.
    // The client animation follows these exactly so what you see = what you get.
    paths: row?.paths ?? null,
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
