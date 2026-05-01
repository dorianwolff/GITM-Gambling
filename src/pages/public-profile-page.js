/**
 * public-profile-page.js
 * Read-only view of another player's profile: stats, equipped cosmetics,
 * and their full owned-items collection grouped by category and rarity.
 *
 * Route: /players/:id
 * Reached from: leaderboard rows, auction listing seller links, etc.
 *
 * RLS allows any authenticated user to SELECT profiles and user_items,
 * so no server-side work needed beyond the v5 schema.
 */
import { h, mount } from '../utils/dom.js';
import { appShell } from '../ui/layout/app-shell.js';
import { supabase } from '../lib/supabase.js';
import { userStore } from '../state/user-store.js';
import { toastError } from '../ui/components/toast.js';
import { formatCredits, initials, shortName } from '../utils/format.js';
import { spinner } from '../ui/components/spinner.js';
import {
  ITEM_RARITY, RARITY_ORDER, CATEGORY_LABEL, CATEGORIES,
  listInventoryFor,
} from '../games/market/market-api.js';
import { logger } from '../lib/logger.js';

export function renderPublicProfile(ctx) {
  const userId = ctx.params.id;
  let profile = null;
  let inventory = [];
  let loading = true;
  let error = null;

  const root = h('div.flex.flex-col.gap-4', {}, []);
  const redraw = () => mount(root, view());

  // Redirect to /profile if it's the current user viewing themselves.
  const me = userStore.get().user;
  if (me && me.id === userId) {
    ctx.navigate('/profile', { replace: true });
    return appShell(h('div', {}, []));
  }

  Promise.all([
    supabase
      .from('profiles')
      .select('id, display_name, email, avatar_url, credits, peak_credits, total_wagered, total_won, created_at, case_pity, biggest_single_win, cases_opened, items_unique, items_total')
      .eq('id', userId)
      .single()
      .then((r) => {
        if (r.error) throw r.error;
        return r.data;
      }),
    listInventoryFor(userId).catch((e) => {
      logger.warn('inventory fetch failed', e);
      return [];
    }),
  ])
    .then(([p, inv]) => {
      profile = p;
      inventory = inv ?? [];
      loading = false;
      redraw();
    })
    .catch((e) => {
      loading = false;
      error = e.message ?? String(e);
      redraw();
    });

  function view() {
    if (loading) {
      return h('div.flex.items-center.justify-center.py-20.gap-3.text-muted', {}, [
        spinner(), 'Loading profile…',
      ]);
    }
    if (error || !profile) {
      return h('div.glass.neon-border.p-10.text-center', {}, [
        h('h2.text-xl.font-semibold.text-accent-rose', {}, ['Profile not found']),
        h('p.text-sm.text-muted.mt-2', {}, [error ?? 'This player does not exist.']),
        h('a.btn-ghost.h-9.px-4.text-xs.inline-block.mt-4', {
          href: '/leaderboard', 'data-link': '',
        }, ['← Back to leaderboard']),
      ]);
    }

    const equipped = inventory.filter((r) => r.equipped);
    const equippedFrame = equipped.find((r) => r.item?.category === 'frame');
    const equippedTitle = equipped.find((r) => r.item?.category === 'title');
    const equippedBadges = equipped.filter((r) => r.item?.category === 'badge');

    return h('div.flex.flex-col.gap-5', {}, [
      // Header
      h('div.flex.items-center.justify-between.gap-3.flex-wrap', {}, [
        h('a.btn-ghost.h-9.px-3.text-xs', {
          href: '/leaderboard', 'data-link': '',
        }, ['← Leaderboard']),
      ]),

      // Hero card
      h(
        'div.glass.neon-border.p-6.flex.items-center.gap-5.flex-wrap',
        {
          style: equippedFrame
            ? {
                border: `2px solid ${equippedFrame.item?.metadata?.color ?? '#22e1ff'}`,
                boxShadow: `0 0 24px ${equippedFrame.item?.metadata?.color ?? '#22e1ff'}55`,
              }
            : {},
        },
        [
          // Avatar with equipped frame effect
          h(
            'div.relative.w-24.h-24.rounded-2xl.flex.items-center.justify-center.text-3xl.font-bold.shrink-0',
            {
              style: {
                background: profile.avatar_url
                  ? `center/cover no-repeat url(${profile.avatar_url})`
                  : 'linear-gradient(145deg,#1a1e2a,#0a0d14)',
                border: `2px solid ${equippedFrame ? (equippedFrame.item?.metadata?.color ?? '#22e1ff') : 'rgba(255,255,255,0.1)'}`,
                boxShadow: equippedFrame
                  ? `0 0 16px ${equippedFrame.item?.metadata?.color ?? '#22e1ff'}88`
                  : 'none',
              },
            },
            profile.avatar_url ? [] : [initials(profile.display_name, profile.email)]
          ),
          h('div.flex.flex-col.gap-1.min-w-0.flex-1', {}, [
            h('h1.text-3xl.font-semibold.heading-grad.truncate', {}, [
              shortName(profile.display_name, profile.email),
            ]),
            equippedTitle
              ? h('div.text-sm.font-mono', { style: { color: ITEM_RARITY[equippedTitle.item.rarity].color } }, [
                  equippedTitle.item?.metadata?.text ?? equippedTitle.item?.name,
                ])
              : h('div.text-xs.text-muted', {}, ['No title equipped']),
            equippedBadges.length > 0
              ? h('div.flex.gap-1.mt-2.flex-wrap', {},
                  equippedBadges.map((b) => badgeChip(b.item)))
              : null,
            h('div.text-[10px].text-muted.mt-1', {}, [
              `Joined ${new Date(profile.created_at).toLocaleDateString()}`,
            ]),
          ]),
        ]
      ),

      // Stats grid
      h('div.grid.grid-cols-2.md:grid-cols-4.gap-3', {}, [
        stat('Credits', formatCredits(profile.credits), '#22e1ff'),
        stat('Peak credits', formatCredits(profile.peak_credits ?? 0), '#ffd96b'),
        stat('Wagered total', formatCredits(profile.total_wagered ?? 0), '#b06bff'),
        stat('Won total', formatCredits(profile.total_won ?? 0), '#3ddc7e'),
      ]),

      // Collection
      collectionView(inventory),
    ]);
  }

  redraw();
  return appShell(root);
}

function stat(label, value, color) {
  return h('div.glass.neon-border.p-4.flex.flex-col.gap-1', {
    style: { boxShadow: `0 0 14px ${color}22` },
  }, [
    h('span.text-[10px].text-muted.uppercase.tracking-widest', {}, [label]),
    h('span.text-xl.font-mono.font-bold', { style: { color } }, [value]),
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
        boxShadow: `0 0 6px ${r.glow}`,
      },
    },
    [
      item.metadata?.emoji ? h('span.text-sm', {}, [item.metadata.emoji]) : null,
      h('span', {}, [item.name.replace(/^Badge · /, '')]),
    ]
  );
}

function collectionView(inventory) {
  if (inventory.length === 0) {
    return h('div.glass.neon-border.p-8.text-center', {}, [
      h('p.text-sm.text-muted', {}, ['No collectibles yet. Open a few cases and shop the market.']),
    ]);
  }

  // Group by category, then sorted within each by rarity (highest first).
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

  return h('div.flex.flex-col.gap-4', {}, [
    h('h2.text-xl.font-semibold.heading-grad', {}, ['Collection']),
    ...CATEGORIES
      .filter((c) => byCat[c]?.length)
      .map((cat) =>
        h('div.glass.neon-border.p-4.flex.flex-col.gap-3', {}, [
          h('div.flex.items-center.justify-between', {}, [
            h('h3.text-sm.uppercase.tracking-widest.text-muted', {}, [CATEGORY_LABEL[cat]]),
            h('span.text-[10px].text-muted', {}, [`${byCat[cat].length} unique`]),
          ]),
          h(
            'div.grid.grid-cols-2.sm:grid-cols-3.md:grid-cols-4.lg:grid-cols-5.gap-2',
            {},
            byCat[cat].map((row) => itemTile(row))
          ),
        ])
      ),
  ]);
}

function itemTile(row) {
  const item = row.item;
  const meta = ITEM_RARITY[item?.rarity] ?? ITEM_RARITY.common;
  return h(
    'div.relative.rounded-xl.p-3.flex.flex-col.gap-1.items-center.text-center',
    {
      style: {
        background: 'linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))',
        border: `1px solid ${meta.color}55`,
        boxShadow: `inset 0 0 12px ${meta.glow}22`,
      },
    },
    [
      row.qty > 1
        ? h('span.absolute.top-1.right-1.text-[10px].font-mono.px-1.rounded', {
            style: { background: 'rgba(0,0,0,0.5)', color: '#fff' },
          }, [`×${row.qty}`])
        : null,
      row.equipped
        ? h('span.absolute.top-1.left-1.text-[10px].font-bold.px-1.rounded', {
            style: { background: meta.color, color: '#000' },
          }, ['EQUIPPED'])
        : null,
      item?.image_url
        ? h('img', {
            src: item.image_url, alt: item.name,
            style: { width: '48px', height: '48px', objectFit: 'contain' },
          })
        : h('span.text-3xl', {}, [item?.metadata?.emoji ?? categoryIcon(item?.category)]),
      h('span.text-xs.font-semibold.leading-tight.line-clamp-2', {
        style: { color: meta.color },
      }, [item?.name ?? 'Unknown item']),
      h('span.text-[9px].uppercase.tracking-widest.text-muted', {}, [meta.label]),
    ]
  );
}

function categoryIcon(c) {
  return { badge: '🏅', frame: '🖼️', title: '📜', effect: '✨', trophy: '🏆' }[c] ?? '❔';
}
