/**
 * dice-api.js
 * Wrapper around play_dice RPC.
 */
import { supabase } from '../../lib/supabase.js';

export async function playDice(amount, target, over) {
  const { data, error } = await supabase.rpc('play_dice', {
    p_amount: amount,
    p_target: target,
    p_over: over,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    newBalance: row.new_balance,
    won: row.won,
    roll: row.roll,
    multiplier: Number(row.multiplier),
    payout: row.payout,
  };
}

export function expectedMultiplier(target, over) {
  const winChance = over ? (100 - target) / 100 : (target - 1) / 100;
  if (winChance <= 0) return 0;
  return 0.97 / winChance;
}
