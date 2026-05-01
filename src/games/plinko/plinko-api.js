/**
 * plinko-api.js
 * Thin wrapper around play_plinko RPC.
 */
import { supabase } from '../../lib/supabase.js';

export const PLINKO_ROWS = [8, 10, 12];
export const PLINKO_RISKS = ['low', 'medium', 'high'];

/** Multiplier tables by row count (must match SQL plinko_mult table). */
export const PLINKO_MULTS = Object.freeze({
  8: {
    low:    [2.0, 1.5, 1.2, 1.1, 0.9, 1.1, 1.2, 1.5, 2.0],
    medium: [4.0, 2.0, 1.4, 1.1, 0.5, 1.1, 1.4, 2.0, 4.0],
    high:   [10.0, 5.0, 2.0, 1.2, 0.2, 1.2, 2.0, 5.0, 10.0],
  },
  10: {
    low:    [2.0, 1.5, 1.3, 1.2, 1.1, 1.0, 1.1, 1.2, 1.3, 1.5, 2.0],
    medium: [5.0, 2.5, 1.6, 1.2, 1.0, 0.5, 1.0, 1.2, 1.6, 2.5, 5.0],
    high:   [16.0, 8.0, 4.0, 2.0, 1.2, 0.2, 1.2, 2.0, 4.0, 8.0, 16.0],
  },
  12: {
    low:    [2.0, 1.6, 1.4, 1.3, 1.2, 1.1, 1.0, 1.1, 1.2, 1.3, 1.4, 1.6, 2.0],
    medium: [8.0, 4.0, 2.0, 1.4, 1.1, 1.0, 0.5, 1.0, 1.1, 1.4, 2.0, 4.0, 8.0],
    high:   [24.0, 12.0, 6.0, 3.0, 1.8, 1.0, 0.2, 1.0, 1.8, 3.0, 6.0, 12.0, 24.0],
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
