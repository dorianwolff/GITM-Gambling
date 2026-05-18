/**
 * admin-service.js
 * Client wrappers for secure admin-only RPCs and admin dashboard data.
 */
import { supabase } from '../lib/supabase.js';

const USER_FIELDS = `
  id, display_name, email, avatar_url, credits, peak_credits,
  total_wagered, total_won, biggest_single_win, cases_opened,
  items_unique, items_total, streak_days, last_claim_date,
  is_admin, is_banned, banned_at, banned_by, ban_reason, created_at
`;

const ITEM_FIELDS = `
  id, slug, name, description, category, rarity, source, shop_price,
  metadata, is_unique, gacha_only
`;

export async function fetchAdminUsers() {
  const { data, error } = await supabase
    .from('profiles')
    .select(USER_FIELDS)
    .order('is_banned', { ascending: true })
    .order('display_name', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function fetchAdminCollectibles() {
  const { data, error } = await supabase
    .from('market_items')
    .select(ITEM_FIELDS)
    .in('category', ['effect', 'frame', 'title', 'badge', 'trophy'])
    .order('category', { ascending: true })
    .order('rarity', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function adminGrantCredits({ amount, targetUserId = null, grantToAll = false, zeroOnly = false, note = '' }) {
  const { data, error } = await supabase.rpc('admin_grant_credits', {
    p_amount: amount,
    p_target_user: targetUserId,
    p_all: grantToAll,
    p_zero_only: zeroOnly,
    p_note: note || null,
  });
  if (error) throw error;
  return data ?? 0;
}

export async function adminSetBan({ userId, banned, reason = '' }) {
  const { data, error } = await supabase.rpc('admin_set_user_ban', {
    p_user: userId,
    p_banned: banned,
    p_reason: reason || null,
  });
  if (error) throw error;
  return data;
}

export async function adminGrantCollectible({ itemId, targetUserId = null, grantToAll = false, quantity = 1, note = '' }) {
  const { data, error } = await supabase.rpc('admin_grant_collectible', {
    p_item: itemId,
    p_target_user: targetUserId,
    p_all: grantToAll,
    p_qty: quantity,
    p_note: note || null,
  });
  if (error) throw error;
  return data ?? 0;
}

export async function adminResetAllProgress() {
  const { error } = await supabase.rpc('admin_reset_all_progress');
  if (error) throw error;
}

// ── Rotation controls ──────────────────────────────────────────────────────

/** Returns current active rotation rows plus the extra_slots offset. */
export async function adminGetRotation() {
  const { data, error } = await supabase.rpc('admin_get_rotation');
  if (error) throw error;
  const rows = data ?? [];
  return {
    games:       rows.map((r) => ({ gameId: r.game_id, endsAt: r.ends_at, startedAt: r.started_at })),
    extraSlots:  rows[0]?.extra_slots ?? 0,
  };
}

/**
 * Advance the rotation by `steps` slots (default 1) for all users.
 * Returns the updated rotation rows.
 */
export async function adminAdvanceRotation(steps = 1) {
  const { data, error } = await supabase.rpc('admin_advance_rotation', { p_steps: steps });
  if (error) throw error;
  const rows = data ?? [];
  return rows.map((r) => ({ gameId: r.game_id, endsAt: r.ends_at, startedAt: r.started_at }));
}

/** Reset extra_slots to 0 (wall-clock rotation). Returns the updated rotation. */
export async function adminResetRotationOffset() {
  const { data, error } = await supabase.rpc('admin_reset_rotation_offset');
  if (error) throw error;
  const rows = data ?? [];
  return rows.map((r) => ({ gameId: r.game_id, endsAt: r.ends_at, startedAt: r.started_at }));
}
