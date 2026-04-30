/**
 * emoji-hunt-page.js
 * Information page about the emoji hunt mini-game. The actual emojis float
 * in an ambient overlay (see src/games/emoji-hunt/ambient-overlay.js) on
 * every page once the user is signed in. Admins can manually spawn one
 * here to test or trigger an event.
 */
import { h, mount } from '../../utils/dom.js';
import { appShell } from '../../ui/layout/app-shell.js';
import { listActiveHunts, spawnHuntAsAdmin } from '../../services/emoji-hunt-service.js';
import { userStore } from '../../state/user-store.js';
import { toastError, toastSuccess } from '../../ui/components/toast.js';
import { spinner } from '../../ui/components/spinner.js';
import { timeAgo } from '../../utils/format.js';

export function renderEmojiHunt(ctx) {
  const isAdmin = !!userStore.get().profile?.is_admin;

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
              h('div.flex.items-center.justify-between.text-sm.glass.p-2', {}, [
                h('span.text-2xl', {}, [r.emoji]),
                h('span.text-muted', {}, [`spawned ${timeAgo(r.created_at)}`]),
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

  const adminPanel = isAdmin
    ? h('div.glass.neon-border.p-5.flex.flex-col.gap-3', {}, [
        h('h3.text-sm.text-muted.uppercase.tracking-widest', {}, ['Admin']),
        h(
          'button.btn-primary.h-10',
          {
            onclick: async () => {
              try {
                await spawnHuntAsAdmin();
                toastSuccess('Hunt spawned for everyone');
                refresh();
              } catch (e) {
                toastError(e.message);
              }
            },
          },
          ['✨ Spawn one now']
        ),
      ])
    : null;

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
        adminPanel ?? h('div', {}, []),
      ]),
    ])
  );
}
