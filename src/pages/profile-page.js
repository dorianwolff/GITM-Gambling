/**
 * profile-page.js
 *
 * Your own editable profile. In addition to the display-name form and the
 * stats grid, this page now surfaces your full cosmetic collection with
 * inline equip / unequip and "list for auction" actions. Read-only visits
 * by other users are served by `public-profile-page.js` — the two pages
 * share the same visual language so they feel unified.
 */
import { h, mount } from '../utils/dom.js';
import { appShell } from '../ui/layout/app-shell.js';
import { userStore, patchProfile } from '../state/user-store.js';
import { updateDisplayName } from '../services/profile-service.js';
import { toastError, toastSuccess } from '../ui/components/toast.js';
import { promptModal } from '../ui/components/modal.js';
import { signOut } from '../auth/auth-service.js';
import { formatCredits, initials, shortName } from '../utils/format.js';
import { spinner } from '../ui/components/spinner.js';
import {
  listMyInventory,
  equipItem,
  listForAuction,
  feePercent,
  ITEM_RARITY,
  RARITY_ORDER,
  CATEGORY_LABEL,
  CATEGORIES,
} from '../games/market/market-api.js';
import { logger } from '../lib/logger.js';

export function renderProfile() {
  let inventory = [];
  let invLoading = true;
  let invError = null;

  const root = h('div.max-w-3xl.mx-auto.w-full.flex.flex-col.gap-5', {}, []);
  const redraw = () => mount(root, view());

  async function loadInventory() {
    invLoading = true;
    try {
      inventory = await listMyInventory();
      invError = null;
    } catch (e) {
      logger.warn('profile: inventory fetch failed', e);
      invError = e.message ?? String(e);
    } finally {
      invLoading = false;
      redraw();
    }
  }
  loadInventory();

  // Keep in sync with profile mutations (credits, display_name, etc.)
  const unsub = userStore.subscribe(() => redraw());
  // There's no ctx on this page (called from guard), so tidy on detach via
  // a MutationObserver hook:
  const detachObs = new MutationObserver(() => {
    if (!document.body.contains(root)) {
      unsub();
      detachObs.disconnect();
    }
  });
  detachObs.observe(document.body, { childList: true, subtree: true });

  async function doEquip(row) {
    try {
      await equipItem(row.item_id, !row.equipped);
      await loadInventory();
    } catch (e) { toastError(e.message); }
  }

  async function doList(row) {
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
      await loadInventory();
    } catch (e) { toastError(e.message); }
  }

  function view() {
    const p = userStore.get().profile;
    const u = userStore.get().user;

    // Equipped bits for the hero card header
    const equipped = inventory.filter((r) => r.equipped);
    const equippedFrame = equipped.find((r) => r.item?.category === 'frame');
    const equippedTitle = equipped.find((r) => r.item?.category === 'title');
    const equippedBadges = equipped.filter((r) => r.item?.category === 'badge');

    const nameInput = h('input.input', { value: p?.display_name ?? '', maxlength: 40 });
    const saveBtn = h(
      'button.btn-primary.h-10',
      {
        onclick: async () => {
          saveBtn.disabled = true;
          try {
            const updated = await updateDisplayName(u.id, nameInput.value);
            patchProfile({ display_name: updated.display_name });
            toastSuccess('Saved');
          } catch (e) {
            toastError(e.message);
          } finally {
            saveBtn.disabled = false;
          }
        },
      },
      ['Save']
    );

    const frameColor = equippedFrame?.item?.metadata?.color ?? '#22e1ff';
    const avatar = h(
      'div.w-20.h-20.rounded-2xl.text-2xl.font-bold.text-black.flex.items-center.justify-center.shadow-glow.shrink-0',
      {
        style: equippedFrame
          ? {
              background: 'linear-gradient(135deg, #22e1ff, #b06bff)',
              border: `2px solid ${frameColor}`,
              boxShadow: `0 0 18px ${frameColor}88`,
            }
          : {
              background: 'linear-gradient(135deg, #22e1ff, #b06bff)',
            },
      },
      [initials(p?.display_name, p?.email)]
    );

    return h('div.flex.flex-col.gap-5', {}, [
      h('h1.text-3xl.font-semibold.heading-grad', {}, ['Profile']),

      // Identity + name edit
      h('div.glass.neon-border.p-6.flex.flex-col.gap-5', {
        style: equippedFrame ? {
          border: `1px solid ${frameColor}55`,
          boxShadow: `0 0 16px ${frameColor}22`,
        } : {},
      }, [
        h('div.flex.items-center.gap-4.flex-wrap', {}, [
          avatar,
          h('div.flex.flex-col.min-w-0.flex-1', {}, [
            h('div.text-xl.font-semibold.truncate', {}, [shortName(p?.display_name, p?.email)]),
            equippedTitle
              ? h('div.text-sm.font-mono', {
                  style: { color: ITEM_RARITY[equippedTitle.item.rarity].color },
                }, [equippedTitle.item?.metadata?.text ?? equippedTitle.item?.name])
              : h('div.text-sm.text-muted', {}, [p?.email]),
            equippedBadges.length > 0
              ? h('div.flex.gap-1.mt-2.flex-wrap', {}, equippedBadges.map((b) => badgeChip(b.item)))
              : null,
            p?.is_admin
              ? h('span.chip.mt-2.bg-accent-magenta/20.border-accent-magenta/40.text-accent-magenta', {}, ['ADMIN'])
              : null,
          ]),
        ]),

        h('div.flex.flex-col.gap-2', {}, [
          h('label.text-xs.text-muted.uppercase.tracking-widest', {}, ['Display name']),
          nameInput,
          h('div.flex.gap-2', {}, [saveBtn]),
        ]),

        h('div.grid.grid-cols-2.sm:grid-cols-4.gap-3.pt-4.border-t.border-white/5', {}, [
          stat('Balance',       formatCredits(p?.credits ?? 0), 'text-accent-cyan'),
          stat('Peak credits',  formatCredits(p?.peak_credits ?? p?.credits ?? 0), 'text-accent-amber'),
          stat('Total wagered', formatCredits(p?.total_wagered ?? 0)),
          stat('Total won',     formatCredits(p?.total_won ?? 0), 'text-accent-lime'),
        ]),
        h('div.grid.grid-cols-2.sm:grid-cols-4.gap-3', {}, [
          stat('Biggest win', formatCredits(p?.biggest_single_win ?? 0), 'text-accent-amber'),
          stat('Cases opened', String(p?.cases_opened ?? 0)),
          stat('Unique items', String(p?.items_unique ?? 0), 'text-accent-cyan'),
          stat('Total pieces', String(p?.items_total ?? 0)),
        ]),

        h('div.flex.justify-end.pt-2', {}, [
          h('button.btn-danger.h-10', { onclick: () => signOut() }, ['Sign out']),
        ]),
      ]),

      // Collection
      h('div.flex.flex-col.gap-3', {}, [
        h('div.flex.items-end.justify-between.gap-3.flex-wrap', {}, [
          h('div', {}, [
            h('h2.text-xl.font-semibold.heading-grad', {}, ['Your collection']),
            h('p.text-xs.text-muted', {}, [
              'Equip cosmetics to show them on your profile, or list duplicates in the auction house.',
            ]),
          ]),
          h('a.btn-ghost.h-9.px-3.text-xs', { href: '/market', 'data-link': '' }, ['Market →']),
        ]),
        invLoading
          ? h('div.flex.items-center.gap-3.text-muted.py-10.justify-center', {}, [spinner(), 'Loading…'])
          : invError
            ? h('div.glass.neon-border.p-6.text-center.text-accent-rose', {}, [invError])
            : inventory.length === 0
              ? h('div.glass.neon-border.p-10.text-center', {}, [
                  h('p.text-sm.text-muted', {}, ['No items yet. Open some cases or visit the shop.']),
                  h('div.flex.gap-2.justify-center.mt-4', {}, [
                    h('a.btn-primary.h-10.px-4.text-sm', { href: '/games/cases', 'data-link': '' }, ['Open a case']),
                    h('a.btn-ghost.h-10.px-4.text-sm',   { href: '/market',       'data-link': '' }, ['Browse shop']),
                  ]),
                ])
              : inventoryByCategory(inventory, doEquip, doList),
      ]),
    ]);
  }

  redraw();
  return appShell(root);
}

function stat(label, value, color = 'text-white') {
  return h('div.glass.p-3.flex.flex-col.gap-1', {}, [
    h('span.text-[10px].text-muted.uppercase.tracking-widest', {}, [label]),
    h(`span.${color}.font-mono.text-lg.tabular-nums`, {}, [value]),
  ]);
}

function badgeChip(item) {
  if (!item) return null;
  const r = ITEM_RARITY[item.rarity] ?? ITEM_RARITY.common;
  return h(
    'span.inline-flex.items-center.gap-1.px-2.py-1.rounded-md.text-[10px].font-bold.uppercase.tracking-widest',
    {
      title: item.name,
      style: {
        background: `${r.color}18`,
        color: r.color,
        border: `1px solid ${r.color}55`,
      },
    },
    [
      item.metadata?.emoji ? h('span.text-sm', {}, [item.metadata.emoji]) : null,
      h('span', {}, [item.name.replace(/^Badge · /, '')]),
    ]
  );
}

function inventoryByCategory(inventory, onEquip, onList) {
  const byCat = {};
  for (const r of inventory) {
    const cat = r.item?.category ?? 'other';
    (byCat[cat] ??= []).push(r);
  }
  for (const cat of Object.keys(byCat)) {
    byCat[cat].sort((a, b) => {
      const ra = RARITY_ORDER.indexOf(a.item?.rarity);
      const rb = RARITY_ORDER.indexOf(b.item?.rarity);
      return rb - ra;
    });
  }
  return h('div.flex.flex-col.gap-3', {},
    CATEGORIES
      .filter((c) => byCat[c]?.length)
      .map((cat) =>
        h('div.glass.neon-border.p-4.flex.flex-col.gap-3', {}, [
          h('div.flex.items-center.justify-between', {}, [
            h('h3.text-sm.uppercase.tracking-widest.text-muted', {}, [CATEGORY_LABEL[cat]]),
            h('span.text-[10px].text-muted', {}, [`${byCat[cat].length} unique`]),
          ]),
          h('div.grid.grid-cols-2.sm:grid-cols-3.md:grid-cols-4.gap-2', {},
            byCat[cat].map((row) => tile(row, onEquip, onList))),
        ])
      )
  );
}

function tile(row, onEquip, onList) {
  const item = row.item;
  if (!item) return null;
  const meta = ITEM_RARITY[item.rarity] ?? ITEM_RARITY.common;
  return h(
    'div.relative.rounded-xl.p-3.flex.flex-col.gap-2.items-center.text-center',
    {
      style: {
        background: 'linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))',
        border: `1px solid ${meta.color}55`,
        boxShadow: row.equipped ? `0 0 14px ${meta.glow}` : `inset 0 0 10px ${meta.glow}22`,
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

      item.image_url
        ? h('img', { src: item.image_url, alt: item.name,
            style: { width: '48px', height: '48px', objectFit: 'contain', marginTop: '10px' } })
        : h('span.text-3xl.mt-2', {}, [item.metadata?.emoji ?? categoryEmoji(item.category)]),

      h('span.text-xs.font-semibold.leading-tight.line-clamp-2', {
        style: { color: meta.color },
      }, [item.name]),
      h('span.text-[9px].uppercase.tracking-widest.text-muted', {}, [meta.label]),

      h('div.flex.gap-1.w-full.mt-auto', {}, [
        h('button.flex-1.h-7.text-[10px].font-semibold.rounded-md.transition-colors', {
          onclick: () => onEquip(row),
          style: {
            background: row.equipped ? 'rgba(255,109,138,0.15)' : 'rgba(34,225,255,0.15)',
            border: `1px solid ${row.equipped ? '#ff6d8a' : '#22e1ff'}55`,
            color: row.equipped ? '#ff6d8a' : '#22e1ff',
          },
        }, [row.equipped ? 'Unequip' : 'Equip']),
        h('button.flex-1.h-7.text-[10px].font-semibold.rounded-md.transition-colors', {
          onclick: () => onList(row),
          style: {
            background: 'rgba(255,217,107,0.12)',
            border: '1px solid rgba(255,217,107,0.35)',
            color: '#ffd96b',
          },
        }, ['List ⚖️']),
      ]),
    ]
  );
}

function categoryEmoji(c) {
  return { badge: '🏅', frame: '🖼️', title: '📜', effect: '✨', trophy: '🏆' }[c] ?? '❔';
}
