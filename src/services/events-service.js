/**
 * events-service.js
 * Read events / event_bets and call the create / bet / resolve RPCs.
 */
import { supabase } from '../lib/supabase.js';

export async function listEvents({ status = 'all', limit = 50 } = {}) {
  let q = supabase
    .from('events')
    .select('*, creator:creator_id(display_name,avatar_url)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (status === 'open') q = q.is('resolved_at', null).eq('cancelled', false);
  if (status === 'resolved') q = q.not('resolved_at', 'is', null);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

export async function getEvent(id) {
  const { data, error } = await supabase
    .from('events')
    .select('*, creator:creator_id(display_name,avatar_url)')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

export async function listBetsForEvent(eventId) {
  const { data, error } = await supabase
    .from('event_bets')
    .select('*, user:user_id(display_name,avatar_url)')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createEvent({ title, description, options, closesAt }) {
  const { data, error } = await supabase.rpc('create_event', {
    p_title: title,
    p_description: description ?? '',
    p_options: options,
    p_closes_at: new Date(closesAt).toISOString(),
  });
  if (error) throw error;
  return data; // event id
}

export async function placeBet(eventId, optionIdx, amount) {
  const { data, error } = await supabase.rpc('place_event_bet', {
    p_event: eventId,
    p_option: optionIdx,
    p_amount: amount,
  });
  if (error) throw error;
  return data;
}

export async function resolveEvent(eventId, winningOption) {
  const { error } = await supabase.rpc('resolve_event', {
    p_event: eventId,
    p_winning_option: winningOption,
  });
  if (error) throw error;
}

export function subscribeToEvent(eventId, onChange) {
  const channel = supabase
    .channel(`event:${eventId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'event_bets', filter: `event_id=eq.${eventId}` },
      onChange
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'events', filter: `id=eq.${eventId}` },
      onChange
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
}

export function subscribeToEventList(onInsert) {
  const channel = supabase
    .channel('events:list')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'events' }, onInsert)
    .subscribe();
  return () => supabase.removeChannel(channel);
}

export function tallyBets(bets, optionsCount) {
  const totals = new Array(optionsCount).fill(0);
  const counts = new Array(optionsCount).fill(0);
  for (const b of bets) {
    totals[b.option_idx] = (totals[b.option_idx] ?? 0) + b.amount;
    counts[b.option_idx] = (counts[b.option_idx] ?? 0) + 1;
  }
  const total = totals.reduce((a, b) => a + b, 0);
  return { totals, counts, total };
}
