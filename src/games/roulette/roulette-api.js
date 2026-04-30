/**
 * roulette-api.js
 */
import { supabase } from '../../lib/supabase.js';

export const RED_NUMBERS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

export function colorOf(n) {
  if (n === 0) return 'green';
  return RED_NUMBERS.has(n) ? 'red' : 'black';
}

/**
 * @param {Array<{type:string,value:string|number,amount:number}>} bets
 */
export async function playRoulette(bets) {
  const payload = bets.map((b) => ({
    type: b.type,
    value: String(b.value),
    amount: Number(b.amount),
  }));
  const { data, error } = await supabase.rpc('play_roulette', { p_bets: payload });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    newBalance: row.new_balance,
    roll: row.roll,
    color: row.color,
    totalWager: row.total_wager,
    totalPayout: row.total_payout,
    breakdown: row.breakdown,
  };
}

// Wheel order on a European single-zero wheel (clockwise).
export const WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14,
  31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];
