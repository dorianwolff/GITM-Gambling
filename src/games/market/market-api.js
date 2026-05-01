/**
 * market-api.js
 * Client wrapper over the market_* RPCs and tables.
 *
 * Tables used (read-only from the client):
 *   market_items       — catalogue
 *   user_items         — per-user inventory
 *   market_listings    — active / past auctions
 *   market_bids        — bid history
 *
 * RPCs used:
 *   market_buy      (item_id)                  → add a shop item to inventory
 *   market_equip    (item_id, equipped)        → equip/unequip cosmetic
 *   market_list     (item_id, start, hours)    → create auction listing
 *   market_bid      (listing_id, amount)       → place bid (escrows funds)
 *   market_cancel   (listing_id)               → seller cancels listing (no bids)
 *   market_settle   (listing_id)               → finalise expired auction
 */
import { supabase } from '../../lib/supabase.js';

// ----------------------------------------------------------------------------
// Shared metadata (kept in sync with the SQL seed in v5)
// ----------------------------------------------------------------------------

export const CATEGORIES = ['badge', 'frame', 'title', 'effect', 'trophy'];
export const CATEGORY_LABEL = {
  badge: 'Badge',
  frame: 'Frame',
  title: 'Title',
  effect: 'Effect',
  trophy: 'Trophy',
};

/** Rarity metadata mirrors case rarities. Kept here so market UI is self-contained. */
export const ITEM_RARITY = {
  common:    { label: 'Common',    color: '#8a8f99', glow: 'rgba(138,143,153,0.4)'  },
  uncommon:  { label: 'Uncommon',  color: '#3ddc7e', glow: 'rgba(61,220,126,0.5)'   },
  rare:      { label: 'Rare',      color: '#22c2ff', glow: 'rgba(34,194,255,0.55)'  },
  epic:      { label: 'Epic',      color: '#b06bff', glow: 'rgba(176,107,255,0.65)' },
  legendary: { label: 'Legendary', color: '#ff9a2e', glow: 'rgba(255,154,46,0.75)'  },
  jackpot:   { label: 'Jackpot',   color: '#ffd96b', glow: 'rgba(255,217,107,0.95)' },
  ultra:     { label: 'ULTRA',     color: '#ff4cf2', glow: 'rgba(255,76,242,1)'     },
};
export const RARITY_ORDER = ['common','uncommon','rare','epic','legendary','jackpot','ultra'];

// ----------------------------------------------------------------------------
// Catalogue / inventory fetchers
// ----------------------------------------------------------------------------

export async function listAllItems() {
  const { data, error } = await supabase
    .from('market_items')
    .select('*')
    .order('rarity', { ascending: true })
    .order('shop_price', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data ?? [];
}

export async function listShopItems() {
  const { data, error } = await supabase
    .from('market_items')
    .select('*')
    .eq('source', 'shop')
    .order('shop_price', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function listMyInventory(userId) {
  const uid = userId ?? (await supabase.auth.getUser()).data.user?.id;
  if (!uid) return [];
  const { data, error } = await supabase
    .from('user_items')
    .select('*, item:market_items(*)')
    .eq('user_id', uid)
    .gt('qty', 0)
    .order('first_acquired_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Alias for public profile view. */
export async function listInventoryFor(userId) {
  return listMyInventory(userId);
}

// ----------------------------------------------------------------------------
// Auctions
// ----------------------------------------------------------------------------

export async function listActiveAuctions({ limit = 60 } = {}) {
  const { data, error } = await supabase
    .from('market_listings')
    .select('*, item:market_items(*), seller:profiles!market_listings_seller_id_fkey(id, display_name, avatar_url)')
    .eq('status', 'active')
    .gte('ends_at', new Date().toISOString())
    .order('ends_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function listMyListings(userId, { includeFinished = true } = {}) {
  const uid = userId ?? (await supabase.auth.getUser()).data.user?.id;
  if (!uid) return [];
  let q = supabase
    .from('market_listings')
    .select('*, item:market_items(*)')
    .eq('seller_id', uid)
    .order('created_at', { ascending: false });
  if (!includeFinished) q = q.eq('status', 'active');
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function listMyBidsOn(userId) {
  const uid = userId ?? (await supabase.auth.getUser()).data.user?.id;
  if (!uid) return [];
  const { data, error } = await supabase
    .from('market_listings')
    .select('*, item:market_items(*), seller:profiles!market_listings_seller_id_fkey(id, display_name)')
    .eq('current_bidder_id', uid)
    .eq('status', 'active')
    .order('ends_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function getListing(id) {
  const { data, error } = await supabase
    .from('market_listings')
    .select('*, item:market_items(*), seller:profiles!market_listings_seller_id_fkey(id, display_name, avatar_url)')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

export async function listListingBids(listingId, limit = 30) {
  const { data, error } = await supabase
    .from('market_bids')
    .select('*, bidder:profiles(id, display_name)')
    .eq('listing_id', listingId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

// ----------------------------------------------------------------------------
// Write RPCs
// ----------------------------------------------------------------------------

export async function buyItem(itemId) {
  const { data, error } = await supabase.rpc('market_buy', { p_item: itemId });
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function equipItem(itemId, equipped = true) {
  const { data, error } = await supabase.rpc('market_equip', {
    p_item: itemId, p_equipped: equipped,
  });
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function listForAuction(itemId, startPrice, durationHours) {
  const { data, error } = await supabase.rpc('market_list', {
    p_item: itemId,
    p_start_price: startPrice,
    p_duration_hours: durationHours,
  });
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function placeBid(listingId, amount) {
  const { data, error } = await supabase.rpc('market_bid', {
    p_listing: listingId,
    p_amount: amount,
  });
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function cancelListing(listingId) {
  const { data, error } = await supabase.rpc('market_cancel', { p_listing: listingId });
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function settleListing(listingId) {
  const { data, error } = await supabase.rpc('market_settle', { p_listing: listingId });
  if (error) throw error;
  return data?.[0] ?? null;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/**
 * Client mirror of market_fee_percent — kept in sync with SQL so the UI can
 * show a live fee preview on the listing form.
 */
export function feePercent(price) {
  if (price < 100) return 12.0;
  if (price < 1000) return 8.0;
  if (price < 10000) return 5.0;
  if (price < 50000) return 3.5;
  return 2.0;
}

export function feeAmount(price) {
  return Math.floor((price * feePercent(price)) / 100);
}

/** Minimum valid next bid for a listing. */
export function minNextBid(listing) {
  if (listing.current_bid == null) return listing.start_price;
  return listing.current_bid + 1;
}

export function formatDurationRemaining(endsAt) {
  const ms = new Date(endsAt).getTime() - Date.now();
  if (ms <= 0) return 'ended';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  if (h >= 1) return `${h}h ${m}m`;
  if (m >= 1) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Realtime subscription for a single listing (bid arrivals / status changes). */
export function subscribeToListing(listingId, onChange) {
  const ch = supabase
    .channel(`listing:${listingId}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'market_listings', filter: `id=eq.${listingId}` },
      (p) => onChange('listing', p))
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'market_bids', filter: `listing_id=eq.${listingId}` },
      (p) => onChange('bid', p))
    .subscribe();
  return () => { try { supabase.removeChannel(ch); } catch {} };
}

/** Global subscription for the main market feed (any listing change). */
export function subscribeToMarket(onChange) {
  const ch = supabase
    .channel('market:all')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'market_listings' },
      (p) => onChange('listing', p))
    .subscribe();
  return () => { try { supabase.removeChannel(ch); } catch {} };
}
