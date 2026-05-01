/**
 * case-api.js
 * Thin wrappers around the `open_case` RPC and the `case_openings` history
 * table. Server is authoritative for all randomness, rarities and payouts.
 */
import { supabase } from '../../lib/supabase.js';

export const CASE_TIERS = [
  {
    id: 'bronze',
    name: 'Bronze Cache',
    cost: 10,
    icon: '📦',
    accent: 'from-[#b08040] to-[#7a4a17]',
    ring: 'ring-[#b08040]/60',
    blurb: 'Entry-level chest. Cheap spins, small dreams.',
  },
  {
    id: 'silver',
    name: 'Silver Vault',
    cost: 50,
    icon: '🎁',
    accent: 'from-[#c0c8d4] to-[#6a7480]',
    ring: 'ring-[#c0c8d4]/60',
    blurb: 'Scaled-up rewards. The sweet spot.',
  },
  {
    id: 'gold',
    name: 'Gold Treasury',
    cost: 100,
    icon: '💎',
    accent: 'from-[#ffd96b] to-[#8a5a13]',
    ring: 'ring-[#ffd96b]/70',
    blurb: 'High-roller chest. Jackpots pay 4,000 cr.',
  },
];

export const RARITY_META = {
  common:    { label: 'Common',     color: '#8a8f99', bg: 'linear-gradient(180deg,#2a2e38,#15181e)', mult: 0.0, glow: 'rgba(138,143,153,0.3)'  },
  uncommon:  { label: 'Uncommon',   color: '#3ddc7e', bg: 'linear-gradient(180deg,#0f3d24,#07201a)', mult: 1.5, glow: 'rgba(61,220,126,0.45)' },
  rare:      { label: 'Rare',       color: '#22c2ff', bg: 'linear-gradient(180deg,#0a2a44,#06162a)', mult: 2.0, glow: 'rgba(34,194,255,0.55)' },
  epic:      { label: 'Epic',       color: '#b06bff', bg: 'linear-gradient(180deg,#301a55,#170a2a)', mult: 4.0, glow: 'rgba(176,107,255,0.65)'},
  legendary: { label: 'Legendary',  color: '#ff9a2e', bg: 'linear-gradient(180deg,#4a2a08,#2a1608)', mult: 10,  glow: 'rgba(255,154,46,0.75)' },
  jackpot:   { label: 'Jackpot',    color: '#ffd96b', bg: 'linear-gradient(180deg,#5a3a0a,#2a1a04)', mult: 40,  glow: 'rgba(255,217,107,0.95)'},
  ultra:     { label: 'ULTRA',      color: '#ff4cf2', bg: 'linear-gradient(180deg,#3d0633,#14011a)', mult: 100, glow: 'rgba(255,76,242,1)'    },
};

export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'jackpot', 'ultra'];

/** Cumulative probabilities used for the strip visual — kept in sync with SQL. */
export const RARITY_WEIGHTS = {
  common:    60.00,
  uncommon:  26.00,
  rare:      10.00,
  epic:       2.50,
  legendary:  1.20,
  jackpot:    0.25,
  ultra:      0.05,
};

export const BATCH_SIZES = [3, 5, 10, 20, 50];

/** Pity threshold used by the server (kept in sync with SQL). */
export const PITY_THRESHOLD = 10;

/**
 * Open a case.
 * @param {'bronze'|'silver'|'gold'} tier
 * @param {boolean} key — spend 50% extra to remove the common tier.
 */
export async function openCase(tier, key = false) {
  const { data, error } = await supabase.rpc('open_case', {
    p_tier: tier,
    p_key: key,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    newBalance:  row.new_balance,
    tier:        row.tier,
    rarity:      row.rarity,
    reward:      row.reward,
    cost:        row.cost,
    pity:        row.pity,
    pityPopped:  row.pity_popped,
    keyUsed:     row.key_used,
    multiplier:  Number(row.multiplier),
    droppedItem: row.dropped_item ?? null,
  };
}

/**
 * Open N cases in a single transaction. Returns an array of rolls in order,
 * and the server-side pity counter is advanced across them.
 * @param {'bronze'|'silver'|'gold'} tier
 * @param {boolean} key
 * @param {3|5|10|20|50} count
 */
export async function openCaseBatch(tier, key, count) {
  const { data, error } = await supabase.rpc('open_case_batch', {
    p_tier: tier,
    p_key: key,
    p_count: count,
  });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    idx:         r.idx,
    rarity:      r.rarity,
    reward:      r.reward,
    multiplier:  Number(r.mult),
    pityHit:     r.pity_hit,
    cost:        r.cost,
    droppedItem: r.dropped_item ?? null,
  }));
}

/**
 * Fetch a market_items row by id. Used to decorate case-drop toasts.
 * @param {string} itemId
 */
export async function fetchItem(itemId) {
  if (!itemId) return null;
  const { data, error } = await supabase
    .from('market_items')
    .select('*')
    .eq('id', itemId)
    .single();
  if (error) return null;
  return data;
}

/** Last N case openings for the current user. */
export async function listRecentOpenings(limit = 20) {
  const { data, error } = await supabase
    .from('case_openings')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}
