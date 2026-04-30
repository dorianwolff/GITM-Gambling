/**
 * emoji-hunt-service.js
 * Listen for active hunts and claim them.
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

export async function spawnHuntAsAdmin() {
  const { data, error } = await supabase.rpc('spawn_emoji_hunt');
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
