/**
 * emoji-hunt-service.js
 * Listen for active hunts and claim them. Hunts are page-locked: each row
 * carries a `page_path` (the route it lives on) and a `size_px` (the
 * rendered emoji size). The ambient overlay decides which to render based
 * on the current path; the table simply stores all active hunts.
 */
import { supabase } from '../lib/supabase.js';

export async function listActiveHunts() {
  const { data, error } = await supabase
    .from('emoji_hunts')
    .select('*')
    .is('found_by', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function claimHunt(huntId) {
  const { data, error } = await supabase.rpc('claim_emoji_hunt', { p_id: huntId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return { newBalance: row.new_balance, reward: row.reward };
}

/**
 * @param {{page?: string|null, sizePx?: number|null}} [opts]
 *   page    — explicit route to lock the hunt to, or null for server-random
 *   sizePx  — explicit size in px (clamped 32..128), or null for server-random
 */
export async function spawnHuntAsAdmin(opts = {}) {
  const { data, error } = await supabase.rpc('spawn_emoji_hunt', {
    p_page:    opts.page    ?? null,
    p_size_px: opts.sizePx  ?? null,
  });
  if (error) throw error;
  return data;
}

export function subscribeToHunts({ onSpawn, onClaim }) {
  const channel = supabase
    .channel('emoji_hunts:all')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'emoji_hunts' }, (p) =>
      onSpawn?.(p.new)
    )
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'emoji_hunts' }, (p) =>
      onClaim?.(p.new)
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
}
