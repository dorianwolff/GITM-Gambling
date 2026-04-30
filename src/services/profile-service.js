/**
 * profile-service.js
 * Read & lightly mutate the public.profiles row for the signed-in user.
 * Credit-mutating writes are NOT exposed here — those go via RPCs only.
 */
import { supabase } from '../lib/supabase.js';

export async function fetchOrCreateProfile(authUser) {
  // The DB trigger creates the row at signup; here we just read it.
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', authUser.id)
    .maybeSingle();

  if (error) throw error;
  if (data) return data;

  // Fallback (trigger fires asynchronously occasionally)
  await new Promise((r) => setTimeout(r, 400));
  const retry = await supabase.from('profiles').select('*').eq('id', authUser.id).single();
  if (retry.error) throw retry.error;
  return retry.data;
}

export async function refreshProfile(userId) {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
  if (error) throw error;
  return data;
}

export async function updateDisplayName(userId, displayName) {
  const trimmed = String(displayName).trim().slice(0, 40);
  const { data, error } = await supabase
    .from('profiles')
    .update({ display_name: trimmed })
    .eq('id', userId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export function subscribeToOwnProfile(userId, onChange) {
  const channel = supabase
    .channel(`profile:${userId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` },
      (payload) => onChange(payload.new)
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
}
