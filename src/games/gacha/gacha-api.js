/**
 * gacha-api.js
 * Thin client wrapper around the v8 `gacha_pull` and `gacha_remaining_uniques`
 * RPCs. The server is fully authoritative — this module only marshals
 * arguments/results and exposes the rarity metadata used by the UI.
 */
import { supabase } from '../../lib/supabase.js';

// Rarity ladder, mirrored from the v8 gacha_pool check constraint.
// Order matters: indexes determine sort order on the showcase strip.
export const GACHA_RARITY_ORDER = [
  'common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'one_of_one',
];

// Visual metadata, lifted from `RARITY_META` in the case-api but tuned for
// the gacha wheel (hotter, more saturated for mythic+). Kept local to the
// gacha module so the case page's tone doesn't get pulled along when we
// inevitably tweak gacha visuals.
export const GACHA_RARITY_META = Object.freeze({
  common:    { label: 'Common',     color: '#9aa3b2', glow: 'rgba(154,163,178,0.55)', tier: 0 },
  uncommon:  { label: 'Uncommon',   color: '#5ad17e', glow: 'rgba(90,209,126,0.55)',  tier: 1 },
  rare:      { label: 'Rare',       color: '#5aa9ff', glow: 'rgba(90,169,255,0.65)',  tier: 2 },
  epic:      { label: 'Epic',       color: '#c779ff', glow: 'rgba(199,121,255,0.7)',  tier: 3 },
  legendary: { label: 'Legendary',  color: '#ffb347', glow: 'rgba(255,179,71,0.8)',   tier: 4 },
  mythic:    { label: 'Mythic',     color: '#ff5dc8', glow: 'rgba(255,93,200,0.85)',  tier: 5 },
  one_of_one:{ label: 'ONE OF ONE', color: '#ffea00', glow: 'rgba(255,234,0,0.95)',   tier: 6 },
});

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
