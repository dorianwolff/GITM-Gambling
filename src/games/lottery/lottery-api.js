/**
 * lottery-api.js
 * Thin wrapper around play_lottery RPC.
 */
import { supabase } from '../../lib/supabase.js';

export const LOTTO_MIN = 1;
export const LOTTO_MAX = 36;
export const LOTTO_PICK_COUNT = 5;

export const LOTTO_PAYOUT = Object.freeze({
  0: 0,
  1: 0,
  2: 6,
  3: 16,
  4: 100,
  5: 8000,
});

export const MATCH_COLORS = Object.freeze({
  0: '#ff3370',
  1: '#ff6d8a',
  2: '#ffd96b',
  3: '#22c2ff',
  4: '#b06bff',
  5: '#00ffaa',
});

export async function playLottery(bet, picks) {
  const { data, error } = await supabase.rpc('play_lottery', {
    p_bet: bet,
    p_picks: picks,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    newBalance: row.new_balance,
    drawn: row.drawn ?? [],
    matches: row.matches,
    multiplier: Number(row.multiplier),
    payout: row.payout,
    won: row.won,
  };
}
