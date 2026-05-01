/**
 * emoji-hunt-page.js
 * Info page for the always-on emoji-hunt overlay. Floating emojis appear
 * automatically (server-driven, see v7 migration auto_spawn_emoji_hunt) on
 * random pages every minute or two, but anyone can also nudge a manual
 * spawn here for testing or for fun — the server rate-limits abuse.
 */
import { h, mount } from '../../utils/dom.js';
import { appShell } from '../../ui/layout/app-shell.js';
import { listActiveHunts, spawnHunt } from '../../services/emoji-hunt-service.js';
import { toastError, toastSuccess } from '../../ui/components/toast.js';
import { spinner } from '../../ui/components/spinner.js';
import { timeAgo } from '../../utils/format.js';

export function renderEmojiHunt(ctx) {

  const listEl = h('div.flex.flex-col.gap-2', {}, [
    h('div.text-muted.flex.items-center.gap-3', {}, [spinner(), 'Loading…']),
  ]);

  const refresh = () => {
    listActiveHunts()
      .then((rows) => {
        if (!rows.length) {
          mount(
            listEl,
            h('div.text-muted.text-sm.p-4', {}, [
              'No emojis on the loose right now. Stay alert — they appear randomly.',
            ])
          );
          return;
        }
        mount(
          listEl,
          h(
            'div.flex.flex-col.gap-1',
            {},
            rows.map((r) =>
              h('div.flex.items-center.justify-between.gap-2.text-sm.glass.p-2', {}, [
                h(
                  'span',
                  { style: { fontSize: Math.min(48, Math.max(20, r.size_px ?? 32)) + 'px' } },
                  [r.emoji]
                ),
                h('div.flex.flex-col.flex-1.min-w-0', {}, [
                  h('span.text-white/80.font-mono.truncate', {}, [r.page_path ?? 'anywhere']),
                  h('span.text-[11px].text-muted', {}, [`spawned ${timeAgo(r.created_at)}`]),
                ]),
                h('span.text-accent-cyan.font-mono', {}, [`+${r.reward}`]),
              ])
            )
          )
        );
      })
      .catch((e) => mount(listEl, h('div.text-accent-rose', {}, [e.message])));
  };
  refresh();
  const tick = setInterval(refresh, 5000);
  ctx.onCleanup(() => clearInterval(tick));

  // Page picker: known routes the hunt can be locked to. 'random' lets
  // the server pick. 'current' uses whatever path the user is on.
  const PAGES = [
    { value: '__random',  label: 'Random page' },
    { value: '__current', label: 'Current page' },
    { value: '/',                   label: '/ (dashboard)' },
    { value: '/dashboard',          label: '/dashboard' },
    { value: '/events',             label: '/events' },
    { value: '/leaderboard',        label: '/leaderboard' },
    { value: '/history',            label: '/history' },
    { value: '/profile',            label: '/profile' },
    { value: '/market',             label: '/market' },
    { value: '/market/inventory',   label: '/market/inventory' },
    { value: '/games',              label: '/games' },
    { value: '/games/coinflip',     label: '/games/coinflip' },
    { value: '/games/dice',         label: '/games/dice' },
    { value: '/games/roulette',     label: '/games/roulette' },
    { value: '/games/blackjack',    label: '/games/blackjack' },
    { value: '/games/crash',        label: '/games/crash' },
    { value: '/games/cases',        label: '/games/cases' },
    { value: '/games/gacha',        label: '/games/gacha' },
    { value: '/games/lobby',        label: '/games/lobby' },
    { value: '/games/emoji-hunt',   label: '/games/emoji-hunt' },
  ];
  const pageSelect = h(
    'select.input',
    {},
    PAGES.map((p) => h('option', { value: p.value }, [p.label]))
  );
  const sizeSelect = h(
    'select.input',
    {},
    [
      { v: '',    l: 'Random size' },
      { v: '32',  l: 'Tiny (32px)' },
      { v: '48',  l: 'Small (48px)' },
      { v: '72',  l: 'Medium (72px)' },
      { v: '96',  l: 'Large (96px)' },
      { v: '128', l: 'Huge (128px)' },
    ].map((o) => h('option', { value: o.v }, [o.l]))
  );

  // Manual spawn is open to all signed-in users now — the auto-spawner
  // is the primary source, this is just a "make one happen now" button
  // for the impatient. Globally rate-limited server-side.
  const spawnPanel = h('div.glass.neon-border.p-5.flex.flex-col.gap-3', {}, [
    h('h3.text-sm.text-muted.uppercase.tracking-widest', {}, ['Spawn one now']),
    h('div.flex.flex-col.gap-2', {}, [
      h('label.text-[11px].text-muted.uppercase.tracking-widest', {}, ['Page']),
      pageSelect,
    ]),
    h('div.flex.flex-col.gap-2', {}, [
      h('label.text-[11px].text-muted.uppercase.tracking-widest', {}, ['Size']),
      sizeSelect,
    ]),
    h(
      'button.btn-primary.h-10',
      {
        onclick: async () => {
          try {
            let page = pageSelect.value;
            if (page === '__random')  page = null;
            if (page === '__current') page = window.location.pathname;
            const sizePx = sizeSelect.value ? Number(sizeSelect.value) : null;
            await spawnHunt({ page, sizePx });
            toastSuccess(page ? `Hunt spawned on ${page}` : 'Hunt spawned on a random page');
            refresh();
          } catch (e) {
            toastError(e.message);
          }
        },
      },
      ['✨ Spawn']
    ),
    h(
      'p.text-[11px].text-muted.leading-relaxed',
      {},
      [
        'Each hunt lives on exactly one route for 45 seconds. Everyone ',
        'currently on that page sees it; first click claims it.',
      ]
    ),
  ]);

  return appShell(
    h('div.flex.flex-col.gap-4', {}, [
      h('h1.text-3xl.font-semibold.heading-grad', {}, ['Emoji hunt']),
      h('p.text-sm.text-muted.max-w-2xl', {}, [
        'Random emojis appear at the edges of the site. The first person to click one wins ',
        h('span.text-accent-cyan.font-mono', {}, ['25 cr']),
        '. Hunts last 30 seconds. Keep this tab open — you only see them while you\'re here.',
      ]),
      h('div.grid.grid-cols-1.lg:grid-cols-3.gap-4', {}, [
        h('div.lg:col-span-2.glass.neon-border.p-5.flex.flex-col.gap-3', {}, [
          h('h2.text-sm.text-muted.uppercase.tracking-widest', {}, ['Active hunts']),
          listEl,
        ]),
        spawnPanel,
      ]),
    ])
  );
}
