/**
 * market-page.js
 * Central hub for everything economy-related that is not pure credit betting:
 *
 *   Tab 1 · Shop         — browse & purchase cosmetics with credits
 *   Tab 2 · Auctions     — live player-to-player auction house
 *   Tab 3 · Inventory    — your owned cosmetics, equip / list flow
 *   Tab 4 · My listings  — auctions you have active, sold, or cancelled
 *
 * Everything is filterable by rarity + category. Duplicate items show a
 * qty badge and a "List for auction" action. Listing is always an auction
 * with a 1h..48h duration — auction fees follow a real Sotheby's-style
 * tiered schedule that gets cheaper the bigger the sale.
 */
import { h, mount } from '../utils/dom.js';
import { appShell } from '../ui/layout/app-shell.js';
import { userStore, patchProfile } from '../state/user-store.js';
import { refreshProfile } from '../services/profile-service.js';
import { toast, toastError, toastSuccess } from '../ui/components/toast.js';
import { spinner } from '../ui/components/spinner.js';
import { confirmModal, promptModal } from '../ui/components/modal.js';
import { formatCredits } from '../utils/format.js';
import { logger } from '../lib/logger.js';
import {
  listShopItems,
  listActiveAuctions,
  listMyInventory,
  listMyListings,
  listMyBidsOn,
  listListingBids,
  getListing,
  buyItem,
  equipItem,
  listForAuction,
  placeBid,
  cancelListing,
  settleListing,
  subscribeToMarket,
  subscribeToListing,
  feePercent,
  feeAmount,
  minNextBid,
  formatDurationRemaining,
  ITEM_RARITY,
  RARITY_ORDER,
  CATEGORIES,
  CATEGORY_LABEL,
} from '../games/market/market-api.js';

export function renderMarket(ctx) {
  let tab = ctx.query?.tab || 'shop';
  let filterRarity = 'all';
  let filterCategory = 'all';

  // State per tab — lazily loaded on demand.
  const state = {
    shop:       { loading: false, items: [],  loaded: false },
    auctions:   { loading: false, items: [],  loaded: false, tick: null },
    inventory:  { loading: false, items: [],  loaded: false },
    listings:   { loading: false, items: [],  loaded: false },
    bids:       { loading: false, items: [],  loaded: false },
  };

  const root = h('div.flex.flex-col.gap-4', {}, []);
  const redraw = () => mount(root, view());

  // Reload shelves whenever the user's credits change (purchase, bid, refund).
  const unsub = userStore.subscribe(() => redraw());
  ctx.onCleanup(unsub);

  // Subscribe to live auction changes so the UI reflects new bids / ended listings.
  const offMarket = subscribeToMarket(() => {
    // Debounced refetch of the two tabs that depend on listings.
    if (tab === 'auctions') loadAuctions();
    if (tab === 'listings') loadListings();
    if (tab === 'bids') loadBids();
  });
  ctx.onCleanup(offMarket);

  // Auctions need a ticking clock for the countdowns.
  state.auctions.tick = setInterval(() => {
    if (tab === 'auctions' || tab === 'bids' || tab === 'listings') redraw();
  }, 1000);
  ctx.onCleanup(() => clearInterval(state.auctions.tick));

  // ---------------- loaders ----------------
  async function loadShop() {
    state.shop.loading = true; redraw();
    try { state.shop.items = await listShopItems(); state.shop.loaded = true; }
    catch (e) { toastError(e.message); }
    finally   { state.shop.loading = false; redraw(); }
  }
  async function loadAuctions() {
    state.auctions.loading = true; redraw();
    try { state.auctions.items = await listActiveAuctions(); state.auctions.loaded = true; }
    catch (e) { toastError(e.message); }
    finally   { state.auctions.loading = false; redraw(); }
  }
  async function loadInventory() {
    state.inventory.loading = true; redraw();
    try { state.inventory.items = await listMyInventory(); state.inventory.loaded = true; }
    catch (e) { toastError(e.message); }
    finally   { state.inventory.loading = false; redraw(); }
  }
  async function loadListings() {
    state.listings.loading = true; redraw();
    try { state.listings.items = await listMyListings(); state.listings.loaded = true; }
    catch (e) { toastError(e.message); }
    finally   { state.listings.loading = false; redraw(); }
  }
  async function loadBids() {
    state.bids.loading = true; redraw();
    try { state.bids.items = await listMyBidsOn(); state.bids.loaded = true; }
    catch (e) { toastError(e.message); }
    finally   { state.bids.loading = false; redraw(); }
  }

  function switchTab(t) {
    tab = t;
    if (t === 'shop'      && !state.shop.loaded)       loadShop();
    if (t === 'auctions'  && !state.auctions.loaded)   loadAuctions();
    if (t === 'inventory' && !state.inventory.loaded)  loadInventory();
    if (t === 'listings'  && !state.listings.loaded)   loadListings();
    if (t === 'bids'      && !state.bids.loaded)       loadBids();
    redraw();
  }
  // Kick off initial load.
  switchTab(tab);

  // ---------------- actions ----------------
  async function doBuy(item) {
    if ((userStore.get().profile?.credits ?? 0) < item.shop_price) {
      return toastError(`Not enough credits (need ${formatCredits(item.shop_price)})`);
    }
    const ok = await confirmModal({
      title: 'Confirm purchase',
      message: `Buy ${item.name} for ${formatCredits(item.shop_price)} cr?`,
      confirmLabel: `Buy · ${formatCredits(item.shop_price)} cr`,
    });
    if (!ok) return;
    try {
      await buyItem(item.id);
      toastSuccess(`Bought ${item.name}`);
      // Invalidate inventory so next visit refetches.
      state.inventory.loaded = false;
      // Refresh profile credits from server.
      const me = userStore.get().user;
      if (me) { const p = await refreshProfile(me.id); patchProfile(p); }
    } catch (e) { toastError(e.message); }
  }

  async function doEquip(row) {
    try {
      await equipItem(row.item_id, !row.equipped);
      state.inventory.loaded = false;
      await loadInventory();
    } catch (e) { toastError(e.message); }
  }

  async function doListForAuction(row) {
    const item = row.item;
    const startStr = await promptModal({
      title: `List ${item.name}`,
      message:
        `Starting price for 1× ${item.name} (1..1,000,000 cr). ` +
        `Seller fee tapers: ~${feePercent(1000)}% on mid-range, less on big sales.`,
      defaultValue: '100',
      placeholder: 'e.g. 250',
      type: 'number',
      min: 1,
      max: 1000000,
      step: 1,
      confirmLabel: 'Next',
    });
    if (startStr == null) return;
    const startPrice = parseInt(startStr, 10);
    if (!Number.isFinite(startPrice) || startPrice < 1) return toastError('Invalid price');

    const durStr = await promptModal({
      title: 'Auction duration',
      message: 'How many hours should this auction run for? (1..48)',
      defaultValue: '24',
      placeholder: 'hours',
      type: 'number',
      min: 1,
      max: 48,
      step: 1,
      confirmLabel: 'List for auction',
    });
    if (durStr == null) return;
    const hours = parseInt(durStr, 10);
    if (!Number.isFinite(hours) || hours < 1 || hours > 48) return toastError('Duration must be 1..48 hours');

    try {
      await listForAuction(item.id, startPrice, hours);
      toastSuccess(`Listed ${item.name} · ${hours}h`);
      state.inventory.loaded = false; state.listings.loaded = false;
      if (tab === 'inventory') await loadInventory();
    } catch (e) { toastError(e.message); }
  }

  async function doPlaceBid(listing) {
    const me = userStore.get().user;
    if (me?.id === listing.seller_id) return toastError('Cannot bid on your own auction');
    const min = minNextBid(listing);
    const myCredits = userStore.get().profile?.credits ?? 0;
    const str = await promptModal({
      title: `Bid on ${listing.item?.name ?? 'this item'}`,
      message:
        `Minimum bid: ${formatCredits(min)} cr.` +
        (myCredits < min ? ' — you do not have enough credits.' : ''),
      defaultValue: String(min),
      placeholder: `at least ${min}`,
      type: 'number',
      min,
      max: Math.max(min, myCredits),
      step: 1,
      confirmLabel: 'Place bid',
      validate: (raw) => {
        const n = Number(raw);
        if (!Number.isFinite(n)) return 'Must be a number.';
        if (n < min) return `Must be at least ${formatCredits(min)} cr.`;
        if (n > myCredits) return `You only have ${formatCredits(myCredits)} cr.`;
        return null;
      },
    });
    if (str == null) return;
    const amount = parseInt(str, 10);
    if (!Number.isFinite(amount) || amount < min) return toastError(`Bid must be at least ${min}`);
    if (myCredits < amount) return toastError('Not enough credits');

    try {
      await placeBid(listing.id, amount);
      toastSuccess(`Bid placed: ${formatCredits(amount)} cr`);
      const mId = userStore.get().user?.id;
      if (mId) { const p = await refreshProfile(mId); patchProfile(p); }
      if (tab === 'auctions') await loadAuctions();
    } catch (e) { toastError(e.message); }
  }

  async function doCancelListing(li) {
    const ok = await confirmModal({
      title: 'Cancel auction?',
      message: 'You will get your item back. Any active bids are refunded.',
      confirmLabel: 'Cancel listing',
      cancelLabel: 'Keep listed',
      danger: true,
    });
    if (!ok) return;
    try {
      await cancelListing(li.id);
      toastSuccess('Listing cancelled');
      state.listings.loaded = false; state.inventory.loaded = false;
      await loadListings();
    } catch (e) { toastError(e.message); }
  }

  async function doSettle(li) {
    try {
      await settleListing(li.id);
      toastSuccess('Auction settled');
      state.listings.loaded = false; state.auctions.loaded = false;
      await loadListings();
      const me = userStore.get().user;
      if (me) { const p = await refreshProfile(me.id); patchProfile(p); }
    } catch (e) { toastError(e.message); }
  }

  // ---------------- view ----------------
  function view() {
    return h('div.flex.flex-col.gap-4', {}, [
      h('div.flex.items-end.justify-between.gap-3.flex-wrap', {}, [
        h('div', {}, [
          h('h1.text-3xl.font-semibold.heading-grad', {}, ['Market']),
          h('p.text-sm.text-muted', {}, [
            'Cosmetics, badges, frames, and one-of-a-kind case-drops. Buy direct or bid in the auction house.',
          ]),
        ]),
        creditBadge(),
      ]),

      tabBar(tab, switchTab),

      (tab === 'shop' || tab === 'auctions' || tab === 'inventory')
        ? filterBar(filterRarity, filterCategory, (r) => { filterRarity = r; redraw(); }, (c) => { filterCategory = c; redraw(); })
        : null,

      tab === 'shop'      ? shopTab(state.shop, filterRarity, filterCategory, doBuy) :
      tab === 'auctions'  ? auctionsTab(state.auctions, filterRarity, filterCategory, doPlaceBid, doSettle) :
      tab === 'inventory' ? inventoryTab(state.inventory, filterRarity, filterCategory, doEquip, doListForAuction) :
      tab === 'listings'  ? myListingsTab(state.listings, doCancelListing, doSettle) :
      tab === 'bids'      ? myBidsTab(state.bids, doSettle) : null,
    ]);
  }

  redraw();
  return appShell(root, { wide: true });
}

// ----------------------------------------------------------------------------
// Shared UI chunks
// ----------------------------------------------------------------------------

function creditBadge() {
  const c = userStore.get().profile?.credits ?? 0;
  return h('div.glass.p-3.rounded-xl.flex.items-center.gap-2', {}, [
    h('span.text-[10px].text-muted.uppercase.tracking-widest', {}, ['Your credits']),
    h('span.text-xl.font-mono.font-bold.text-accent-cyan.tabular-nums', {}, [formatCredits(c)]),
  ]);
}

function tabBar(current, onSwitch) {
  const t = (id, label) => h(
    'button.px-4.h-10.rounded-lg.text-sm.font-semibold.transition-colors',
    {
      onclick: () => onSwitch(id),
      style: {
        background: current === id ? 'rgba(34,225,255,0.15)' : 'rgba(255,255,255,0.03)',
        border: current === id ? '1px solid #22e1ff' : '1px solid rgba(255,255,255,0.08)',
        color: current === id ? '#22e1ff' : '#fff',
      },
    },
    [label]
  );
  return h('div.flex.gap-2.flex-wrap', {}, [
    t('shop',      '🛒 Shop'),
    t('auctions',  '⚖️ Auctions'),
    t('inventory', '🎒 Inventory'),
    t('listings',  '📋 My listings'),
    t('bids',      '💰 My bids'),
  ]);
}

function filterBar(rarity, category, onRarity, onCategory) {
  const chip = (sel, value, label, color) => h(
    'button.px-3.h-8.rounded-md.text-xs.font-semibold.transition-colors',
    {
      onclick: () => (value === 'all' ? onRarity('all') : (RARITY_ORDER.includes(value) ? onRarity(value) : onCategory(value))),
      style: {
        background: sel === value ? (color ? `${color}25` : 'rgba(34,225,255,0.15)') : 'rgba(255,255,255,0.03)',
        border: `1px solid ${sel === value ? (color ?? '#22e1ff') : 'rgba(255,255,255,0.08)'}`,
        color: sel === value ? (color ?? '#22e1ff') : '#fff',
      },
    },
    [label]
  );
  return h('div.flex.flex-col.gap-2', {}, [
    h('div.flex.items-center.gap-2.flex-wrap', {}, [
      h('span.text-[10px].text-muted.uppercase.tracking-widest.mr-1', {}, ['Rarity']),
      chip(rarity, 'all', 'All'),
      ...RARITY_ORDER.map((r) => chip(rarity, r, ITEM_RARITY[r].label, ITEM_RARITY[r].color)),
    ]),
    h('div.flex.items-center.gap-2.flex-wrap', {}, [
      h('span.text-[10px].text-muted.uppercase.tracking-widest.mr-1', {}, ['Category']),
      chip(category, 'all', 'All'),
      ...CATEGORIES.map((c) => chip(category, c, CATEGORY_LABEL[c])),
    ]),
  ]);
}

// ----------------------------------------------------------------------------
// SHOP
// ----------------------------------------------------------------------------
function shopTab(s, rarity, category, onBuy) {
  if (s.loading && !s.loaded) return loadingBlock();
  const items = s.items
    .filter((i) => rarity === 'all' || i.rarity === rarity)
    .filter((i) => category === 'all' || i.category === category);
  if (items.length === 0) return emptyBlock('No items match your filters.');
  return h('div.grid.grid-cols-2.md:grid-cols-3.lg:grid-cols-4.gap-3', {},
    items.map((item) => shopCard(item, onBuy)));
}

function shopCard(item, onBuy) {
  const meta = ITEM_RARITY[item.rarity];
  const canAfford = (userStore.get().profile?.credits ?? 0) >= item.shop_price;
  return h(
    'div.relative.glass.neon-border.p-4.flex.flex-col.gap-2.transition-transform.hover:-translate-y-0.5',
    {
      style: {
        border: `1px solid ${meta.color}66`,
        boxShadow: `0 0 18px ${meta.glow}33`,
      },
    },
    [
      h('div.flex.items-center.justify-between', {}, [
        h('span.text-[10px].uppercase.tracking-widest.font-bold', { style: { color: meta.color } }, [meta.label]),
        h('span.text-[10px].text-muted.uppercase.tracking-widest', {}, [CATEGORY_LABEL[item.category]]),
      ]),
      h('div.h-24.flex.items-center.justify-center', {}, [
        item.image_url
          ? h('img', { src: item.image_url, alt: item.name, style: { maxHeight: '96px' } })
          : h('span.text-5xl', {}, [item.metadata?.emoji ?? categoryEmoji(item.category)]),
      ]),
      h('div.text-sm.font-semibold.leading-tight.text-center.line-clamp-2', {}, [item.name]),
      item.description
        ? h('div.text-[10px].text-muted.text-center.leading-tight.line-clamp-2', {}, [item.description])
        : null,
      h('button.btn-primary.h-10.mt-auto.text-sm', {
        onclick: () => onBuy(item),
        disabled: !canAfford,
        style: !canAfford ? { opacity: 0.5, cursor: 'not-allowed' } : {},
      }, [`Buy · ${formatCredits(item.shop_price)} cr`]),
    ]
  );
}

function categoryEmoji(c) {
  return { badge: '🏅', frame: '🖼️', title: '📜', effect: '✨', trophy: '🏆' }[c] ?? '❔';
}

// ----------------------------------------------------------------------------
// AUCTIONS
// ----------------------------------------------------------------------------
function auctionsTab(s, rarity, category, onBid, onSettle) {
  if (s.loading && !s.loaded) return loadingBlock();
  const now = Date.now();
  const items = s.items
    .filter((l) => l.item && (rarity === 'all' || l.item.rarity === rarity))
    .filter((l) => l.item && (category === 'all' || l.item.category === category));
  if (items.length === 0) {
    return emptyBlock('No active auctions. Check back later or list your own items from the Inventory tab.');
  }
  return h('div.grid.grid-cols-1.md:grid-cols-2.lg:grid-cols-3.gap-3', {},
    items.map((l) => auctionCard(l, now, onBid, onSettle)));
}

function auctionCard(l, now, onBid, onSettle) {
  const item = l.item;
  const meta = ITEM_RARITY[item?.rarity] ?? ITEM_RARITY.common;
  const me = userStore.get().user?.id;
  const iSeller = me === l.seller_id;
  const iLeading = me === l.current_bidder_id;
  const ended = new Date(l.ends_at).getTime() <= now;

  return h(
    'div.relative.glass.neon-border.p-4.flex.flex-col.gap-2',
    {
      style: {
        border: `1px solid ${meta.color}66`,
        boxShadow: `0 0 18px ${meta.glow}22`,
      },
    },
    [
      h('div.flex.items-center.justify-between', {}, [
        h('span.text-[10px].uppercase.tracking-widest.font-bold', { style: { color: meta.color } }, [meta.label]),
        h('span.text-[10px].font-mono', {
          style: { color: ended ? '#ff6d8a' : '#ffd96b' },
        }, [ended ? 'ended · settle' : `⏱ ${formatDurationRemaining(l.ends_at)}`]),
      ]),
      h('div.h-20.flex.items-center.justify-center', {}, [
        item?.image_url
          ? h('img', { src: item.image_url, alt: item.name, style: { maxHeight: '80px' } })
          : h('span.text-4xl', {}, [item?.metadata?.emoji ?? categoryEmoji(item?.category)]),
      ]),
      h('div.text-sm.font-semibold.text-center.line-clamp-2', {}, [item?.name ?? 'Item']),
      h('div.text-[10px].text-muted.text-center', {}, [
        'Seller · ',
        h('a', {
          href: `/players/${l.seller_id}`, 'data-link': '',
          style: { color: '#22e1ff', textDecoration: 'none' },
        }, [l.seller?.display_name ?? 'Unknown']),
      ]),
      h('div.flex.items-center.justify-between.text-xs.font-mono', {}, [
        h('span.text-muted', {}, ['Current bid']),
        h('span', {
          style: { color: iLeading ? '#3ddc7e' : l.current_bid ? '#fff' : '#8a8f99' },
        }, [
          l.current_bid
            ? `${formatCredits(l.current_bid)} cr${iLeading ? ' (you)' : ''}`
            : `no bids · start ${formatCredits(l.start_price)}`,
        ]),
      ]),
      h('div.text-[9px].text-muted.text-center', {}, [
        `${l.bid_count} bid${l.bid_count === 1 ? '' : 's'}`,
      ]),
      ended
        ? h('button.btn-ghost.h-10.text-sm', { onclick: () => onSettle(l) }, ['Settle auction'])
        : iSeller
          ? h('span.text-[10px].text-center.text-muted.italic', {}, ['Your own auction'])
          : h('button.btn-primary.h-10.text-sm', { onclick: () => onBid(l) },
              [`Bid · min ${formatCredits(minNextBid(l))}`]),
    ]
  );
}

// ----------------------------------------------------------------------------
// INVENTORY
// ----------------------------------------------------------------------------
function inventoryTab(s, rarity, category, onEquip, onList) {
  if (s.loading && !s.loaded) return loadingBlock();
  const rows = s.items
    .filter((r) => rarity === 'all' || r.item?.rarity === rarity)
    .filter((r) => category === 'all' || r.item?.category === category);
  if (rows.length === 0) {
    return emptyBlock('No items in your inventory. Buy from the shop or open cases.');
  }
  return h('div.grid.grid-cols-2.md:grid-cols-3.lg:grid-cols-5.gap-3', {},
    rows.map((row) => inventoryCard(row, onEquip, onList)));
}

function inventoryCard(row, onEquip, onList) {
  const item = row.item;
  if (!item) return null;
  const meta = ITEM_RARITY[item.rarity] ?? ITEM_RARITY.common;
  return h(
    'div.relative.glass.neon-border.p-3.flex.flex-col.gap-2',
    {
      style: {
        border: `1px solid ${meta.color}55`,
        boxShadow: row.equipped ? `0 0 16px ${meta.glow}` : `inset 0 0 12px ${meta.glow}22`,
      },
    },
    [
      row.qty > 1
        ? h('span.absolute.top-1.right-1.text-[10px].font-mono.font-bold.px-1.rounded', {
            style: { background: 'rgba(0,0,0,0.7)', color: '#fff' },
          }, [`×${row.qty}`])
        : null,
      row.equipped
        ? h('span.absolute.top-1.left-1.text-[9px].font-bold.px-1.rounded', {
            style: { background: meta.color, color: '#000' },
          }, ['EQUIPPED'])
        : null,
      h('div.h-20.flex.items-center.justify-center.mt-2', {}, [
        item.image_url
          ? h('img', { src: item.image_url, alt: item.name, style: { maxHeight: '80px' } })
          : h('span.text-4xl', {}, [item.metadata?.emoji ?? categoryEmoji(item.category)]),
      ]),
      h('div.text-xs.font-semibold.text-center.leading-tight.line-clamp-2', {
        style: { color: meta.color },
      }, [item.name]),
      h('div.text-[9px].text-muted.text-center.uppercase.tracking-widest', {}, [
        `${meta.label} · ${CATEGORY_LABEL[item.category]}`,
      ]),
      h('div.flex.gap-1.mt-auto', {}, [
        h('button.flex-1.h-8.text-[11px].font-semibold.rounded-md.transition-colors', {
          onclick: () => onEquip(row),
          style: {
            background: row.equipped ? 'rgba(255,109,138,0.15)' : 'rgba(34,225,255,0.15)',
            border: `1px solid ${row.equipped ? '#ff6d8a' : '#22e1ff'}55`,
            color: row.equipped ? '#ff6d8a' : '#22e1ff',
          },
        }, [row.equipped ? 'Unequip' : 'Equip']),
        row.qty >= 1
          ? h('button.flex-1.h-8.text-[11px].font-semibold.rounded-md.transition-colors', {
              onclick: () => onList(row),
              style: {
                background: 'rgba(255,217,107,0.12)',
                border: '1px solid rgba(255,217,107,0.35)',
                color: '#ffd96b',
              },
            }, ['List ⚖️'])
          : null,
      ]),
    ]
  );
}

// ----------------------------------------------------------------------------
// MY LISTINGS
// ----------------------------------------------------------------------------
function myListingsTab(s, onCancel, onSettle) {
  if (s.loading && !s.loaded) return loadingBlock();
  if (s.items.length === 0) return emptyBlock('You have no listings. Try the Inventory tab to create one.');
  const now = Date.now();
  return h('div.flex.flex-col.gap-2', {},
    s.items.map((l) => myListingRow(l, now, onCancel, onSettle)));
}

function myListingRow(l, now, onCancel, onSettle) {
  const item = l.item;
  const meta = ITEM_RARITY[item?.rarity] ?? ITEM_RARITY.common;
  const ended = new Date(l.ends_at).getTime() <= now;
  const projected = l.current_bid ? l.current_bid - feeAmount(l.current_bid) : null;

  return h(
    'div.glass.p-3.flex.items-center.gap-3.flex-wrap',
    {
      style: {
        border: `1px solid ${meta.color}44`,
      },
    },
    [
      h('span.text-2xl', {}, [item?.metadata?.emoji ?? categoryEmoji(item?.category)]),
      h('div.flex-1.min-w-0', {}, [
        h('div.text-sm.font-semibold.truncate', { style: { color: meta.color } }, [item?.name ?? 'Item']),
        h('div.text-[10px].text-muted.flex.gap-2.flex-wrap', {}, [
          h('span', {}, [`status ${l.status}`]),
          h('span', {}, [`start ${formatCredits(l.start_price)}`]),
          l.bid_count ? h('span.text-accent-cyan', {}, [`${l.bid_count} bid${l.bid_count===1?'':'s'}`]) : null,
          l.status === 'active'
            ? h('span', { style: { color: ended ? '#ff6d8a' : '#ffd96b' } }, [ended ? 'ended' : formatDurationRemaining(l.ends_at)])
            : null,
        ]),
      ]),
      h('div.text-right.min-w-[110px]', {}, [
        l.current_bid
          ? [
              h('div.text-sm.font-mono.text-accent-lime', {}, [`${formatCredits(l.current_bid)} cr`]),
              projected != null
                ? h('div.text-[9px].text-muted', {}, [`net ${formatCredits(projected)} · fee ${feePercent(l.current_bid)}%`])
                : null,
            ]
          : l.status === 'sold'
            ? h('div.text-sm.font-mono.text-accent-lime', {}, [`${formatCredits(l.final_price ?? 0)} cr sold`])
            : h('div.text-sm.font-mono.text-muted', {}, ['no bids']),
      ]),
      l.status === 'active' && ended
        ? h('button.btn-primary.h-9.px-4.text-xs', { onclick: () => onSettle(l) }, ['Settle'])
        : null,
      l.status === 'active' && !ended && l.bid_count === 0
        ? h('button.btn-ghost.h-9.px-4.text-xs', { onclick: () => onCancel(l) }, ['Cancel'])
        : null,
    ]
  );
}

// ----------------------------------------------------------------------------
// MY BIDS
// ----------------------------------------------------------------------------
function myBidsTab(s, onSettle) {
  if (s.loading && !s.loaded) return loadingBlock();
  if (s.items.length === 0) return emptyBlock('You are not the leading bidder on any auctions.');
  const now = Date.now();
  return h('div.flex.flex-col.gap-2', {},
    s.items.map((l) => {
      const item = l.item;
      const meta = ITEM_RARITY[item?.rarity] ?? ITEM_RARITY.common;
      const ended = new Date(l.ends_at).getTime() <= now;
      return h('div.glass.p-3.flex.items-center.gap-3.flex-wrap', {
        style: { border: `1px solid ${meta.color}44` },
      }, [
        h('span.text-2xl', {}, [item?.metadata?.emoji ?? categoryEmoji(item?.category)]),
        h('div.flex-1.min-w-0', {}, [
          h('div.text-sm.font-semibold.truncate', { style: { color: meta.color } }, [item?.name]),
          h('div.text-[10px].text-muted', {}, [
            `Leading bid · ${formatCredits(l.current_bid)} cr · ${ended ? 'ended' : formatDurationRemaining(l.ends_at)}`,
          ]),
        ]),
        ended
          ? h('button.btn-primary.h-9.px-4.text-xs', { onclick: () => onSettle(l) }, ['Settle'])
          : h('span.text-[10px].text-accent-lime.font-mono', {}, ['LEADING']),
      ]);
    }));
}

// ----------------------------------------------------------------------------
// Shared widgets
// ----------------------------------------------------------------------------
function loadingBlock() {
  return h('div.flex.items-center.justify-center.py-20.gap-3.text-muted', {}, [
    spinner(), 'Loading…',
  ]);
}

function emptyBlock(msg) {
  return h('div.glass.neon-border.p-10.text-center', {}, [
    h('p.text-sm.text-muted', {}, [msg]),
  ]);
}
