/**
 * mp-api.js
 * Client wrappers + realtime helpers for multiplayer games.
 *
 * Server tables / RPCs (see v3 migration):
 *   mp_games          — one row per game, full state in jsonb
 *   mp_create_game    — open a new table, escrow ante, status='waiting'
 *   mp_join_game      — join as player_o, escrow ante, status='active'
 *   mp_make_move      — validates turn, applies move, possibly finalizes
 *   mp_resign         — forfeit; opponent wins
 *   mp_cancel_game    — creator cancels a waiting game, gets refund
 */
import { supabase } from '../../lib/supabase.js';

export const MP_VARIANTS = [
  {
    id: 'ttt_chaos',
    name: 'Chaos TTT',
    icon: '🌀',
    blurb:
      'Tic-tac-toe, except every turn one random empty cell is locked — ' +
      'you cannot play there on the very next move.',
    grad: 'from-accent-violet/40 to-accent-cyan/40',
  },
  {
    id: 'ttt_fade',
    name: 'Fade TTT',
    icon: '👻',
    blurb:
      'Each player may only have 3 pieces on the board. When you place a ' +
      '4th, your oldest piece disappears. The board never fills up.',
    grad: 'from-accent-rose/40 to-accent-amber/40',
  },
];

export const ANTE_CHOICES = [10, 25, 50, 100, 250];

export function variantById(id) {
  return MP_VARIANTS.find((v) => v.id === id) ?? { id, name: id, icon: '🎲', blurb: '', grad: '' };
}

// ----------------------------------------------------------------------------
// RPCs
// ----------------------------------------------------------------------------

export async function createGame(gameType, ante) {
  const { data, error } = await supabase.rpc('mp_create_game', {
    p_game_type: gameType,
    p_ante: ante,
  });
  if (error) throw error;
  return data; // uuid
}

export async function joinGame(id) {
  const { data, error } = await supabase.rpc('mp_join_game', { p_id: id });
  if (error) throw error;
  return unwrap(data);
}

export async function cancelGame(id) {
  const { error } = await supabase.rpc('mp_cancel_game', { p_id: id });
  if (error) throw error;
}

export async function resign(id) {
  const { error } = await supabase.rpc('mp_resign', { p_id: id });
  if (error) throw error;
}

export async function makeMove(id, move) {
  const { data, error } = await supabase.rpc('mp_make_move', {
    p_id: id,
    p_move: move,
  });
  if (error) throw error;
  return unwrap(data);
}

// ----------------------------------------------------------------------------
// Queries
// ----------------------------------------------------------------------------

/** Fetch a single game row by id. */
export async function getGame(id) {
  const { data, error } = await supabase
    .from('mp_games')
    .select('*, x:player_x (id, display_name, avatar_url), o:player_o (id, display_name, avatar_url)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** List open (waiting) games. */
export async function listWaiting() {
  const { data, error } = await supabase
    .from('mp_games')
    .select('*, x:player_x (id, display_name, avatar_url)')
    .eq('status', 'waiting')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return data;
}

/** Games the user is involved in and still playing. */
export async function listMine(userId) {
  const { data, error } = await supabase
    .from('mp_games')
    .select('*, x:player_x (id, display_name, avatar_url), o:player_o (id, display_name, avatar_url)')
    .in('status', ['waiting', 'active'])
    .or(`player_x.eq.${userId},player_o.eq.${userId}`)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

// ----------------------------------------------------------------------------
// Realtime
// ----------------------------------------------------------------------------

/**
 * Subscribe to updates on the lobby-relevant slice of mp_games.
 * Fires onChange for every INSERT/UPDATE/DELETE; the callback is responsible
 * for refetching or reconciling.
 */
export function subscribeToLobby(onChange) {
  const channel = supabase
    .channel('mp_games:lobby')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'mp_games' }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}

/** Subscribe to a single game's updates. */
export function subscribeToGame(id, onChange) {
  const channel = supabase
    .channel(`mp_game:${id}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'mp_games', filter: `id=eq.${id}` },
      (p) => onChange(p.new ?? p.old)
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
}

// ----------------------------------------------------------------------------
// Misc
// ----------------------------------------------------------------------------

function unwrap(data) {
  return Array.isArray(data) ? data[0] : data;
}
