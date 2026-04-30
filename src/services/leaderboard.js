/**
 * leaderboard.js
 */
import { supabase } from '../lib/supabase.js';

export async function getLeaderboard(limit = 50) {
  const { data, error } = await supabase
    .from('v_leaderboard')
    .select('*')
    .limit(limit);
  if (error) throw error;
  return data;
}
