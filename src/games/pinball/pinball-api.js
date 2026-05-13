/**
 * pinball-api.js
 * Thin wrappers around the server-start / client-sim / server-settle flow.
 */
import { supabase } from '../../lib/supabase.js';

export async function startPinballRound(bet, ballCount = 3) {
  const { data, error } = await supabase.rpc('play_pinball_round', {
    p_bet: bet,
    p_ball_count: ballCount,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    roundId: row.round_id,
    mapKey: row.map_key,
    mapName: row.map_name,
    seed: Number(row.seed),
    ballCount: Number(row.ball_count ?? ballCount),
    stake: Number(row.stake),
    newBalance: Number(row.new_balance),
  };
}

export async function settlePinballRound(roundId, summary) {
  const { data, error } = await supabase.rpc('settle_pinball_round', {
    p_round_id: roundId,
    p_summary: summary,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    roundId: row.round_id,
    mapKey: row.map_key,
    score: Number(row.score ?? 0),
    comboMax: Number(row.combo_max ?? 0),
    payout: Number(row.payout ?? 0),
    newBalance: Number(row.new_balance ?? 0),
    won: !!row.won,
    summary: row.summary ?? summary,
  };
}
