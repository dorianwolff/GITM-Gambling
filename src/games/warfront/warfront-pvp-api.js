/**
 * warfront-pvp-api.js
 * Thin wrappers around the Warfront PvP Supabase RPCs and realtime helpers.
 */
import { supabase } from '../../lib/supabase.js';

export const WF_PVP_ANTE_CHOICES = [10, 25, 50, 100, 250, 500];
export const WF_PVP_DRAFT_BUDGET = 10;

/** Create a new PvP room. Returns the game row. */
export async function pvpCreate(ante, collection = 'fantasy') {
  const { data, error } = await supabase.rpc('wf_pvp_create', {
    p_ante:       ante,
    p_collection: collection,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

/** Join a waiting room. Returns the updated game row. */
export async function pvpJoin(gameId) {
  const { data, error } = await supabase.rpc('wf_pvp_join', { p_game_id: gameId });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

/**
 * Commit your drafted army.
 * If both players have now committed the server resolves the match and
 * returns a row with status='finished', winner, x_base_hp, o_base_hp set.
 */
export async function pvpCommit(gameId, picks, collection) {
  const { data, error } = await supabase.rpc('wf_pvp_commit', {
    p_game_id:    gameId,
    p_picks:      picks,
    p_collection: collection,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

/**
 * Report animation result to the server.
 * First caller sets the winner (HP comparison); subsequent calls are no-ops.
 * Draw (both HP > 0 or both 0) refunds each player their ante.
 */
export async function pvpResolve(gameId, playerBaseHp, enemyBaseHp) {
  const { data, error } = await supabase.rpc('wf_pvp_resolve', {
    p_game_id:    gameId,
    p_player_hp:  playerBaseHp,
    p_opp_hp:     enemyBaseHp,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

/** Surrender during animation — calling player loses immediately. */
export async function pvpSurrender(gameId) {
  const { data, error } = await supabase.rpc('wf_pvp_surrender', {
    p_game_id: gameId,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

/** Cancel a waiting room (creator only). Refunds the ante. */
export async function pvpCancel(gameId) {
  const { error } = await supabase.rpc('wf_pvp_cancel', { p_game_id: gameId });
  if (error) throw error;
}

/** Fetch open rooms (status='waiting', not created by the current user). */
export async function pvpOpenRooms() {
  const { data, error } = await supabase.rpc('wf_pvp_open_rooms');
  if (error) throw error;
  return data ?? [];
}

/** Fetch a game row with player profile info joined. */
export async function getPvpGame(gameId) {
  const { data, error } = await supabase
    .from('mp_warfront_games')
    .select(`
      *,
      x:player_x ( id, display_name, email ),
      o:player_o ( id, display_name, email )
    `)
    .eq('id', gameId)
    .single();
  if (error) throw error;
  return data;
}

/**
 * Subscribe to real-time updates on a single game row.
 * Returns an unsubscribe function.
 */
export function subscribeToPvpGame(gameId, onChange) {
  const channel = supabase
    .channel(`wf_pvp:${gameId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'mp_warfront_games', filter: `id=eq.${gameId}` },
      onChange,
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
}

/** Subscribe to lobby changes (any insert/update on the mp_warfront_games table). */
export function subscribeToPvpLobby(onChange) {
  const channel = supabase
    .channel('wf_pvp_lobby')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'mp_warfront_games' }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}
