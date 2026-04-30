/**
 * crash-api.js
 */
import { supabase } from '../../lib/supabase.js';

export async function playCrash(amount, cashout) {
  const { data, error } = await supabase.rpc('play_crash', {
    p_amount: amount,
    p_cashout: cashout,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    newBalance: row.new_balance,
    won: row.won,
    crashPoint: Number(row.crash_point),
    payout: row.payout,
  };
}

/**
 * Simulate the multiplier curve growth over time.
 * Used purely for visual animation (server is authoritative on outcome).
 * Returns the multiplier at elapsed seconds t.
 */
export function multiplierAt(tSeconds) {
  return Math.pow(1.06, tSeconds * 4);
}

export function timeForMultiplier(m) {
  return Math.log(m) / (4 * Math.log(1.06));
}
