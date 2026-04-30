/**
 * blackjack-api.js
 * Interactive blackjack RPC wrappers. Every action returns the full updated
 * blackjack_hands row; the page re-renders from that state. Server is
 * authoritative.
 *
 * Game state shape (mirrors public.blackjack_hands):
 *   {
 *     id, user_id, bet,
 *     deck:           int[],   // remaining cards (do not show)
 *     dealer_cards:   int[],   // index 1 is the hole card while status='active'
 *     hands:          [{
 *       cards: int[], bet: int, doubled: bool, done: bool,
 *       surrendered: bool, blackjack: bool,
 *       result?: 'win'|'lose'|'push'|'bust'|'blackjack'|'surrender',
 *       payout?: int, total?: int,
 *     }],
 *     active_hand:        int,
 *     insurance_bet:      int,
 *     insurance_resolved: bool,
 *     status:             'awaiting_insurance' | 'active' | 'done',
 *     outcome_summary:    { dealer_total, total_payout } | null,
 *   }
 */
import { supabase } from '../../lib/supabase.js';

async function call(fn, args) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export const bjStart      = (amount)  => call('bj_start',      { p_amount: amount });
export const bjHit        = (handId)  => call('bj_hit',        { p_hand_id: handId });
export const bjStand      = (handId)  => call('bj_stand',      { p_hand_id: handId });
export const bjDouble     = (handId)  => call('bj_double',     { p_hand_id: handId });
export const bjSplit      = (handId)  => call('bj_split',      { p_hand_id: handId });
export const bjSurrender  = (handId)  => call('bj_surrender',  { p_hand_id: handId });
export const bjInsurance  = (handId, take) =>
  call('bj_insurance', { p_hand_id: handId, p_take: !!take });
