/**
 * gacha-api.js
 * Thin client wrapper around the v8 `gacha_pull` and `gacha_remaining_uniques`
 * RPCs. The server is fully authoritative — this module only marshals
 * arguments/results and re-exports the shared collectible catalog metadata.
 */
import { supabase } from '../../lib/supabase.js';
import {
  GACHA_RARITY_ORDER,
  GACHA_RARITY_META,
  GACHA_POOL_SPECS,
} from '../collectibles/collectibles.js';

export { GACHA_RARITY_ORDER, GACHA_RARITY_META, GACHA_POOL_SPECS };

// Pull cost: keep in sync with v8 gacha_pull body.
export const GACHA_COST_SINGLE = 100;
export const GACHA_COST_TEN    = 900;
export const GACHA_PITY_THRESHOLD = 80;

/**
 * Pull `count` items (1 or 10). Returns an array of pull rows in pull order.
 * Each row: { pullIndex, itemId, slug, name, emoji, rarity, isUnique,
 *            pityPopped, newBalance, newPity }
 */
export async function gachaPull(count) {
  if (count !== 1 && count !== 10) throw new Error('count must be 1 or 10');
  const { data, error } = await supabase.rpc('gacha_pull', { p_count: count });
  if (error) throw error;
  // The RPC returns SQL-cased columns; remap to camelCase for ergonomics.
  return (data ?? []).map((r) => ({
    pullIndex:  r.pull_index,
    itemId:     r.item_id,
    slug:       r.item_slug,
    name:       r.item_name,
    emoji:      r.item_emoji,
    rarity:     r.rarity,
    isUnique:   r.is_unique,
    pityPopped: r.pity_popped,
    newBalance: r.new_balance,
    newPity:    r.new_pity,
  }));
}

/**
 * The public showcase of every one-of-one slot in the pool, with its
 * current owner (or null if still unclaimed). Sorted by slug so the UI
 * order is stable.
 */
export async function listRemainingUniques() {
  const { data, error } = await supabase.rpc('gacha_remaining_uniques');
  if (error) throw error;
  return (data ?? []).map((r) => ({
    itemId:        r.item_id,
    slug:          r.slug,
    name:          r.name,
    rarity:        r.rarity,
    emoji:         r.emoji,
    claimed:       r.claimed,
    claimedBy:     r.claimed_by,
    claimedAt:     r.claimed_at ? new Date(r.claimed_at) : null,
    claimedByName: r.claimed_by_name,
  }));
}
