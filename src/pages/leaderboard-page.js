/**
 * leaderboard-page.js
 */
import { h, mount } from '../utils/dom.js';
import { appShell } from '../ui/layout/app-shell.js';
import { getLeaderboard } from '../services/leaderboard.js';
import { formatCredits, initials } from '../utils/format.js';
import { spinner } from '../ui/components/spinner.js';
import { userStore } from '../state/user-store.js';

export function renderLeaderboard() {
  const list = h('div.flex.flex-col.gap-2', {}, [
    h('div.flex.items-center.gap-3.text-muted', {}, [spinner(), 'Loading…']),
  ]);

  getLeaderboard(50)
    .then((rows) => {
      const meId = userStore.get().user?.id;
      mount(
        list,
        h(
          'div.flex.flex-col.gap-2',
          {},
          rows.map((r, i) => row(r, i + 1, r.id === meId))
        )
      );
    })
    .catch((e) => {
      mount(list, h('div.text-accent-rose', {}, [e.message ?? 'Could not load']));
    });

  return appShell(
    h('div.flex.flex-col.gap-4', {}, [
      h('h1.text-3xl.font-semibold.heading-grad', {}, ['Leaderboard']),
      h('p.text-sm.text-muted', {}, ['Top 50 by current balance.']),
      list,
    ])
  );
}

function row(r, rank, isMe) {
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null;
  const rankEl = h(
    `div.w-10.text-center.font-mono.text-lg.${rank <= 3 ? 'text-accent-amber' : 'text-muted'}`,
    {},
    [medal ?? '#' + rank]
  );
  const av = h(
    'div.w-10.h-10.rounded-xl.bg-white/5.border.border-white/10.flex.items-center.justify-center.text-sm.font-bold',
    {},
    [initials(r.display_name)]
  );

  return h(
    `div.glass.p-3.flex.items-center.gap-4.${isMe ? 'border-accent-cyan/40' : ''}`,
    {},
    [
      rankEl,
      av,
      h('div.flex-1.min-w-0', {}, [
        h('div.font-medium.truncate', {}, [r.display_name]),
        h('div.text-xs.text-muted', {}, [
          `Wagered ${formatCredits(r.total_wagered)} · Won ${formatCredits(r.total_won)}`,
        ]),
      ]),
      h('div.text-right', {}, [
        h('div.font-mono.text-accent-cyan.text-lg.tabular-nums', {}, [formatCredits(r.credits)]),
        h('div.text-[10px].text-muted.uppercase.tracking-widest', {}, ['credits']),
      ]),
    ]
  );
}
