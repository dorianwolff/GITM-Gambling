/**
 * blackjack-api.js
 * Server-side resolved single-shot blackjack. The player picks a "stand at"
 * threshold (12..21) up-front; the server plays both hands and returns the
 * full result.
 */
import { supabase } from '../../lib/supabase.js';

export async function playBlackjack(amount, standAt) {
  const { data, error } = await supabase.rpc('play_blackjack', {
    p_amount: amount,
    p_stand_at: standAt,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    newBalance: row.new_balance,
    outcome: row.outcome, // 'blackjack' | 'win' | 'push' | 'lose' | 'bust'
    playerTotal: row.player_total,
    dealerTotal: row.dealer_total,
    playerHand: row.player_hand,
    dealerHand: row.dealer_hand,
    payout: row.payout,
  };
}

export function cardLabel(v) {
  if (v === 1) return 'A';
  if (v === 10) return '10';
  return String(v);
}
