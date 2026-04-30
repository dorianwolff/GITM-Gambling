/**
 * transactions.js
 * Read the user's credit ledger.
 */
import { supabase } from '../lib/supabase.js';

export async function listMyTransactions({ limit = 50, before } = {}) {
  let q = supabase
    .from('transactions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (before) q = q.lt('created_at', before);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

const KIND_LABEL = {
  daily_claim: 'Daily claim',
  signup_bonus: 'Welcome bonus',
  bet_place: 'Event bet',
  bet_payout: 'Event payout',
  game_coinflip: 'Coinflip',
  game_dice: 'Dice',
  game_roulette: 'Roulette',
  game_blackjack: 'Blackjack',
  game_crash: 'Crash',
  emoji_hunt: 'Emoji hunt',
  admin_grant: 'Admin grant',
  admin_revoke: 'Admin revoke',
};

export function labelKind(kind) {
  return KIND_LABEL[kind] ?? kind;
}
