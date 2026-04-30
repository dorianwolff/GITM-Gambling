/**
 * coinflip-api.js
 * Thin wrapper over the play_coinflip RPC. The server picks the side; the
 * client only animates the result.
 */
import { supabase } from '../../lib/supabase.js';

export async function playCoinflip(amount, side) {
  const { data, error } = await supabase.rpc('play_coinflip', {
    p_amount: amount,
    p_side: side,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    newBalance: row.new_balance,
    won: row.won,
    result: row.result,
    payout: row.payout,
  };
}
