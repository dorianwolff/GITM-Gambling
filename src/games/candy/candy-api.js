/**
 * candy-api.js
 * Thin wrapper around the v9 candy_spin RPC. The server returns a full
 * list of "snapshots" describing the initial board + every cascade
 * round; the client replays them with animation (see candy-page.js).
 *
 * Snapshot kinds:
 *   - { kind:'initial', board: int[36] }
 *   - { kind:'match',   round, cells: int[], round_pay, board_before }
 *   - { kind:'refill',  round, board: int[36] }
 *
 * `board` is a 6x6 grid serialised row-major. Colors are 0..5; -1 = cleared.
 */
import { supabase } from '../../lib/supabase.js';

export const CANDY_COLS = 6;
export const CANDY_ROWS = 6;
export const CANDY_CELLS = CANDY_COLS * CANDY_ROWS;

// Six distinct gem glyphs matching server-side colour indices 0..5.
export const CANDY_GEMS = ['🍒', '🍋', '🍇', '🍏', '🫐', '🍭'];

/**
 * Run one spin. Returns the full replay + final payout.
 * @param {number} bet
 * @returns {Promise<{id:string, payout:number, cascades:number,
 *                    snapshots:Array<object>, newBalance:number}>}
 */
export async function candySpin(bet) {
  const { data, error } = await supabase.rpc('candy_spin', { p_bet: bet });
  if (error) throw error;
  const r = Array.isArray(data) ? data[0] : data;
  return {
    id: r.id,
    payout: r.payout,
    cascades: r.cascades,
    snapshots: r.snapshots ?? [],
    newBalance: r.new_balance,
  };
}
