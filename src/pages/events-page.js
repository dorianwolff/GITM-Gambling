/**
 * events-page.js
 * List of betting events (open / resolved). Realtime: new events appear
 * automatically.
 */
import { h, mount } from '../utils/dom.js';
import { appShell } from '../ui/layout/app-shell.js';
import { listEvents, subscribeToEventList } from '../services/events-service.js';
import { ROUTES } from '../config/constants.js';
import { spinner } from '../ui/components/spinner.js';
import { formatCountdown, msUntil } from '../utils/dates.js';
import { timeAgo } from '../utils/format.js';

export function renderEvents(ctx) {
  let filter = 'open';
  const grid = h('div.grid.grid-cols-1.md:grid-cols-2.xl:grid-cols-3.gap-4', {}, [
    h('div.text-muted.flex.items-center.gap-3', {}, [spinner(), 'Loading…']),
  ]);

  let events = [];
  const reload = () => {
    listEvents({ status: filter }).then((rows) => {
      events = rows;
      renderGrid();
    });
  };
  const renderGrid = () => {
    if (!events.length) {
      mount(grid, h('div.text-muted.col-span-full.p-10.text-center', {}, ['No events yet.']));
      return;
    }
    mount(
      grid,
      h(
        'div.contents',
        {},
        events.map(eventCard)
      )
    );
  };

  const tabs = ['open', 'resolved', 'all'].map((k) =>
    h(
      `button.${filter === k ? 'btn-primary' : 'btn-ghost'}.h-9.text-xs`,
      {
        onclick: () => {
          filter = k;
          // re-render tabs
          tabs.forEach((b, i) => {
            const key = ['open', 'resolved', 'all'][i];
            b.className = (key === filter ? 'btn-primary' : 'btn-ghost') + ' h-9 text-xs';
          });
          reload();
        },
      },
      [k === 'open' ? 'Open' : k === 'resolved' ? 'Resolved' : 'All']
    )
  );

  reload();
  const off = subscribeToEventList(() => reload());
  ctx.onCleanup(off);

  // tick countdowns every second
  const tick = setInterval(() => {
    document.querySelectorAll('[data-closes-at]').forEach((el) => {
      const t = msUntil(el.getAttribute('data-closes-at'));
      el.textContent = t > 0 ? `Closes in ${formatCountdown(t)}` : 'Closed';
    });
  }, 1000);
  ctx.onCleanup(() => clearInterval(tick));

  return appShell(
    h('div.flex.flex-col.gap-4', {}, [
      h('div.flex.items-center.justify-between.gap-3.flex-wrap', {}, [
        h('div.flex.flex-col', {}, [
          h('h1.text-3xl.font-semibold.heading-grad', {}, ['Events']),
          h('p.text-sm.text-muted', {}, [
            'Bet on whatever the school day brings. Created by students, resolved by them.',
          ]),
        ]),
        h('div.flex.items-center.gap-2', {}, [
          ...tabs,
          h(
            'a.btn-primary.h-9.text-xs',
            { href: ROUTES.CREATE_EVENT, 'data-link': '' },
            ['+ New event']
          ),
        ]),
      ]),
      grid,
    ])
  );
}

function eventCard(e) {
  const closed = e.resolved_at != null || msUntil(e.closes_at) <= 0;
  const status = e.cancelled
    ? { txt: 'Cancelled', cls: 'bg-white/10 text-white/60' }
    : e.resolved_at
      ? { txt: 'Resolved', cls: 'bg-accent-lime/20 text-accent-lime' }
      : closed
        ? { txt: 'Awaiting resolve', cls: 'bg-accent-amber/20 text-accent-amber' }
        : { txt: 'Open', cls: 'bg-accent-cyan/20 text-accent-cyan' };

  return h(
    'a.glass.neon-border.p-5.flex.flex-col.gap-3.transition.hover:-translate-y-0.5.hover:shadow-glow',
    { href: `/events/${e.id}`, 'data-link': '' },
    [
      h('div.flex.items-start.justify-between.gap-3', {}, [
        h('div.font-semibold.text-base.line-clamp-2', {}, [e.title]),
        h(`span.text-[10px].font-semibold.uppercase.tracking-widest.px-2.py-1.rounded-full.${status.cls}`, {}, [status.txt]),
      ]),
      e.description
        ? h('div.text-xs.text-white/60.line-clamp-3', {}, [e.description])
        : null,
      h('div.flex.flex-wrap.gap-1', {}, e.options.slice(0, 4).map((o) => h('span.chip', {}, [o]))),
      h('div.flex.items-center.justify-between.text-xs.text-muted.pt-2.border-t.border-white/5', {}, [
        h('span', {}, [`by ${e.creator?.display_name ?? '?'} · ${timeAgo(e.created_at)}`]),
        e.resolved_at
          ? h('span.text-accent-lime', {}, ['Won: ' + e.options[e.winning_option]])
          : h('span', { 'data-closes-at': e.closes_at }, [
              `Closes in ${formatCountdown(msUntil(e.closes_at))}`,
            ]),
      ]),
    ]
  );
}
