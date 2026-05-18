/**
 * achievement-service.js
 * Client wrappers for the achievements system.
 */
import { supabase } from '../lib/supabase.js';

/**
 * Returns all active achievement definitions combined with the current
 * user's progress and claim state.
 *
 * Each row includes:
 *   code, name, description, category,
 *   reward_credits, reward_item_slug, sort_order,
 *   current_value, target_value,
 *   is_unlocked, is_claimed, can_claim
 */
export async function listMyAchievements() {
  const { data, error } = await supabase.rpc('list_my_achievements');
  if (error) throw error;
  return data ?? [];
}

/**
 * Claim a completed achievement and receive its reward.
 * Returns { code, reward_credits, reward_item_slug }.
 * Throws if condition not met or already claimed.
 */
export async function claimAchievement(code) {
  const { data, error } = await supabase.rpc('claim_achievement', { p_code: code });
  if (error) throw error;
  return data;
}

/**
 * Quick check: are there any achievements the user can claim right now?
 * Returns true if so (used to show the notification badge).
 */
export async function hasUnclaimedAchievements() {
  try {
    const rows = await listMyAchievements();
    return rows.some((r) => r.can_claim);
  } catch {
    return false;
  }
}
