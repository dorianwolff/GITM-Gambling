/**
 * mines-api.js
 * Thin wrapper around the v9 minesweeper RPCs. Server is authoritative:
 * mine layout is never sent to the client while the game is active; the
 * layout only leaks on bust (so the bust reveal can render).
 *
 * Grid is fixed 5×5 = 25 cells, indexed 0..24 in row-major order.
 */
import { supabase } from '../../lib/supabase.js';

export const MINES_GRID_SIZE = 5;
export const MINES_TOTAL_CELLS = MINES_GRID_SIZE * MINES_GRID_SIZE; // 25

/** @returns {Promise<{id:string, newBalance:number, bet:number, mines:number}>} */
export async function minesStart(bet, mines) {
  const { data, error } = await supabase.rpc('minesweeper_start', {
    p_bet: bet, p_mines: mines,
  });
  if (error) throw error;
  const r = Array.isArray(data) ? data[0] : data;
  return { id: r.id, newBalance: r.new_balance, bet: r.bet, mines: r.mines };
}

/**
 * Reveal one cell.
 * @returns {Promise<{
 *   status: 'active'|'busted',
 *   revealed: number[],
 *   hitMine: boolean,
 *   multBp: number,
 *   currentMulti: number,
 *   minesRevealed: number[],   // full layout, only populated on bust
 *   potentialPayout: number,
 *   newBalance: number,
 * }>}
 */
export async function minesReveal(gameId, cell) {
  const { data, error } = await supabase.rpc('minesweeper_reveal', {
    p_id: gameId, p_cell: cell,
  });
  if (error) throw error;
  const r = Array.isArray(data) ? data[0] : data;
  return {
    status: r.status,
    revealed: r.revealed ?? [],
    hitMine: r.hit_mine,
    multBp: r.mult_bp,
    currentMulti: Number(r.current_multi),
    minesRevealed: r.mines_revealed ?? [],
    potentialPayout: r.potential_payout,
    newBalance: r.new_balance,
  };
}

/**
 * Cash out the current multiplier.
 * @returns {Promise<{payout:number, multBp:number, newBalance:number, minesRevealed:number[]}>}
 */
export async function minesCashout(gameId) {
  const { data, error } = await supabase.rpc('minesweeper_cashout', {
    p_id: gameId,
  });
  if (error) throw error;
  const r = Array.isArray(data) ? data[0] : data;
  return {
    payout: r.payout,
    multBp: r.mult_bp,
    newBalance: r.new_balance,
    minesRevealed: r.mines_revealed ?? [],
  };
}

/** Load the user's currently-active game, if any (for resume on reload). */
export async function minesActive() {
  const { data, error } = await supabase.rpc('minesweeper_active');
  if (error) throw error;
  const r = Array.isArray(data) ? data[0] : null;
  if (!r) return null;
  return {
    id: r.id,
    bet: r.bet,
    mines: r.mines,
    revealed: r.revealed ?? [],
    multBp: r.mult_bp,
    potentialPayout: r.potential_payout,
  };
}

/**
 * Client-side mirror of the server's multiplier formula. Used to show a
 * live "next reveal will be X.XXx" hint without waiting for the server.
 * The server still decides the true payout; this is preview only.
 */
export function minesMultiplier(mines, revealed) {
  if (revealed <= 0) return 1;
  const total = MINES_TOTAL_CELLS;
  let m = 1;
  for (let k = 0; k < revealed; k++) {
    const denom = total - mines - k;
    if (denom <= 0) return 0;
    m *= (total - k) / denom;
  }
  return m * 0.97;
}
