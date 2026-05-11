/**
 * leaderboard-page.js
 *
 * One page, multiple leaderboards. Tabs across the top let the user pick
 * the ranking dimension (credits, peak, biggest win, cases opened, etc.)
 * — each tab is backed by its own lightweight Postgres view so switching
 * boards is a single round-trip with zero joins.
 *
 * Board data is cached per-tab for the lifetime of the page render so
 * clicking back to a tab you've already loaded is instant.
 */
import { h, mount } from '../utils/dom.js';
import { appShell } from '../ui/layout/app-shell.js';
import {
  getLeaderboardByType,
  LEADERBOARDS,
  boardById,
} from '../services/leaderboard.js';
import { formatCredits, initials } from '../utils/format.js';
import { spinner } from '../ui/components/spinner.js';
import { userStore } from '../state/user-store.js';

export function renderLeaderboard(ctx) {
  let currentId = (ctx?.query?.board && boardById(ctx.query.board).id) || 'credits';
  const cache = new Map(); // id → { rows | error }

  const root = h('div.flex.flex-col.gap-3.sm:gap-4', {}, []);
  const redraw = () => mount(root, view());

  async function loadBoard(id) {
    if (cache.has(id)) { redraw(); return; }
    cache.set(id, { loading: true });
    redraw();
    try {
      const rows = await getLeaderboardByType(id, 50);
      cache.set(id, { rows });
    } catch (e) {
      cache.set(id, { error: e.message ?? String(e) });
    }
    redraw();
  }

  function switchBoard(id) {
    if (id === currentId) return;
    currentId = id;
    // Keep URL in sync so links / back-button remember the tab.
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('board', id);
      history.replaceState({}, '', url);
    } catch {}
    loadBoard(id);
  }

  loadBoard(currentId);

  function view() {
    const board = boardById(currentId);
    const entry = cache.get(currentId) ?? { loading: true };

    return h('div.flex.flex-col.gap-4', {}, [
      h('div.flex.items-end.justify-between.gap-3.flex-wrap', {}, [
        h('div', {}, [
          h('h1.text-2xl.sm:text-3xl.font-semibold.heading-grad', {}, ['Leaderboards']),
          h('p.text-xs.sm:text-sm.text-muted.max-w-2xl', {}, [board.blurb]),
        ]),
      ]),
      tabBar(currentId, switchBoard),
      entry.loading
        ? h('div.flex.items-center.gap-3.text-muted.py-10.justify-center', {}, [spinner(), 'Loading…'])
        : entry.error
          ? h('div.glass.neon-border.p-10.text-center.text-accent-rose', {}, [entry.error])
          : entry.rows.length === 0
            ? h('div.glass.neon-border.p-10.text-center.text-muted', {}, [
                'Nobody is on this board yet — be the first.',
              ])
            : boardList(entry.rows, board),
    ]);
  }

  redraw();
  return appShell(root);
}

// ----------------------------------------------------------------------------

function tabBar(current, onSwitch) {
  return h(
    'div.grid.grid-cols-2.gap-2.sm:flex.sm:gap-2.sm:overflow-x-auto.pb-1.sm:pb-0',
    { style: { scrollbarWidth: 'thin' } },
    LEADERBOARDS.map((b) => h(
      'button.w-full.sm:w-auto.px-2.sm:px-4.py-2.sm:h-10.rounded-lg.text-[11px].sm:text-xs.font-semibold.leading-tight.text-center.whitespace-normal.sm:whitespace-nowrap.transition-all.flex.items-center.justify-center.gap-2.flex-1.sm:flex-none.sm:flex-shrink-0',
      {
        onclick: () => onSwitch(b.id),
        style: {
          background: current === b.id ? `${b.accent}22` : 'rgba(255,255,255,0.03)',
          border: `1px solid ${current === b.id ? b.accent : 'rgba(255,255,255,0.08)'}`,
          color: current === b.id ? b.accent : '#fff',
          boxShadow: current === b.id ? `0 0 12px ${b.accent}44` : 'none',
        },
      },
      [h('span', {}, [b.icon]), h('span', {}, [b.label])]
    ))
  );
}

function boardList(rows, board) {
  const meId = userStore.get().user?.id;
  return h('div.flex.flex-col.gap-2.sm:gap-3', {},
    rows.map((r, i) => row(r, r.rank ?? (i + 1), r.id === meId, board))
  );
}

function row(r, rank, isMe, board) {
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null;
  const rankEl = h(
    `div.w-8.text-center.font-mono.text-base.${rank <= 3 ? 'text-accent-amber' : 'text-muted'}`,
    {},
    [medal ?? '#' + rank]
  );
  const av = h(
    'div.w-9.h-9.rounded-xl.bg-white/5.border.border-white/10.flex.items-center.justify-center.text-xs.font-bold.shrink-0',
    r.avatar_url
      ? { style: { background: `center/cover no-repeat url(${r.avatar_url})` } }
      : {},
    r.avatar_url ? [] : [initials(r.display_name)]
  );

  return h(
    `a.glass.p-2.sm:p-3.flex.items-center.gap-2.sm:gap-3.transition-all.hover:-translate-y-0.5.hover:border-accent-cyan/40.${isMe ? 'border-accent-cyan/40' : ''}`,
    {
      href: isMe ? '/profile' : `/players/${r.id}`,
      'data-link': '',
      style: { cursor: 'pointer', textDecoration: 'none', color: 'inherit', maxWidth: '100%', overflow: 'hidden' },
    },
    [
      h('div.flex.items-center.gap-2.sm:gap-3.w-full.min-w-0.flex-1', {}, [
        rankEl,
        av,
        h('div.flex-1.min-w-0', {}, [
          h('div.font-medium.truncate.flex.items-center.gap-2.text-[12px] sm:text-sm.leading-tight', {}, [
            h('span', {}, [r.display_name]),
            isMe ? h('span.text-[9px].text-accent-cyan.uppercase.tracking-widest', {}, ['you']) : null,
          ]),
          h('div.text-[9px].sm:text-xs.text-muted.truncate.leading-tight', {}, [secondaryLine(r, board)]),
        ]),
      ]),
      h('div.text-right.shrink-0.w-auto.flex.flex-col.items-end.justify-center.gap-0.5.min-w-0', {}, [
        h('div.font-mono.text-[12px].sm:text-lg.tabular-nums.whitespace-nowrap', {
          style: { color: board.accent },
        }, [
          formatValue(r.value, board.suffix),
        ]),
        h('div.text-[8px].sm:text-[9px].text-muted.uppercase.tracking-widest', {}, [board.suffix]),
      ]),
      h('div.text-muted.opacity-50.self-center.hidden.sm:block', { style: { fontSize: '14px' } }, ['›']),
    ]
  );
}

function formatValue(v, suffix) {
  if (suffix === 'cr') return formatCredits(v);
  // raw count — commas for readability
  return Number(v ?? 0).toLocaleString();
}

/**
 * Render a contextual secondary line based on which board we're showing.
 * Always picks two other metrics so rows feel information-dense without
 * being cluttered.
 */
function secondaryLine(r, board) {
  switch (board.id) {
    case 'credits':
      return `Wagered ${formatCredits(r.total_wagered ?? 0)} · Won ${formatCredits(r.total_won ?? 0)}`;
    case 'peak':
      return `Now ${formatCredits(r.credits ?? 0)} · Won ${formatCredits(r.total_won ?? 0)}`;
    case 'biggest':
      return `Now ${formatCredits(r.credits ?? 0)} · Peak ${formatCredits(r.peak_credits ?? 0)}`;
    case 'won':
      return `Now ${formatCredits(r.credits ?? 0)} · Peak ${formatCredits(r.peak_credits ?? 0)} · Biggest ${formatCredits(r.biggest_single_win ?? 0)}`;
    case 'wagered':
      return `Now ${formatCredits(r.credits ?? 0)} · Won ${formatCredits(r.total_won ?? 0)}`;
    case 'cases':
      return `Biggest ${formatCredits(r.biggest_single_win ?? 0)} · Unique items ${r.items_unique ?? 0}`;
    case 'collection':
      return `Total pieces ${r.items_total ?? 0} · Peak ${formatCredits(r.peak_credits ?? 0)}`;
    default:
      return '';
  }
}
