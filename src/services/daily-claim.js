/**
 * daily-claim.js
 * Wrapper around the claim_daily_credits RPC.
 */
import { supabase } from '../lib/supabase.js';
import { todayKey } from '../utils/dates.js';

export async function claimDailyCredits() {
  const { data, error } = await supabase.rpc('claim_daily_credits');
  if (error) throw error;
  // function returns rows
  const row = Array.isArray(data) ? data[0] : data;
  return {
    newBalance: row.new_balance,
    streak: row.streak,
    awarded: row.awarded,
  };
}

export function canClaimToday(profile) {
  if (!profile) return false;
  return profile.last_claim_date !== todayKey();
}
