/**
 * profile-page.js
 */
import { h } from '../utils/dom.js';
import { appShell } from '../ui/layout/app-shell.js';
import { userStore, patchProfile } from '../state/user-store.js';
import { updateDisplayName } from '../services/profile-service.js';
import { toastError, toastSuccess } from '../ui/components/toast.js';
import { signOut } from '../auth/auth-service.js';
import { formatCredits, initials, shortName } from '../utils/format.js';

export function renderProfile() {
  const p = userStore.get().profile;
  const u = userStore.get().user;

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

  const avatar = h(
    'div.w-20.h-20.rounded-2xl.bg-gradient-to-br.from-accent-cyan.to-accent-violet.text-2xl.font-bold.text-black.flex.items-center.justify-center.shadow-glow',
    {},
    [initials(p?.display_name, p?.email)]
  );

  const card = h('div.glass.neon-border.p-6.flex.flex-col.gap-5', {}, [
    h('div.flex.items-center.gap-4', {}, [
      avatar,
      h('div.flex.flex-col', {}, [
        h('div.text-xl.font-semibold', {}, [shortName(p?.display_name, p?.email)]),
        h('div.text-sm.text-muted', {}, [p?.email]),
        p?.is_admin
          ? h(
              'span.chip.mt-1.bg-accent-magenta/20.border-accent-magenta/40.text-accent-magenta',
              {},
              ['ADMIN']
            )
          : null,
      ]),
    ]),
    h('div.flex.flex-col.gap-2', {}, [
      h('label.text-xs.text-muted.uppercase.tracking-widest', {}, ['Display name']),
      nameInput,
      h('div.flex.gap-2', {}, [saveBtn]),
    ]),
    h('div.grid.grid-cols-3.gap-3.pt-4.border-t.border-white/5', {}, [
      stat('Balance', formatCredits(p?.credits ?? 0), 'text-accent-cyan'),
      stat('Total wagered', formatCredits(p?.total_wagered ?? 0)),
      stat('Total won', formatCredits(p?.total_won ?? 0), 'text-accent-lime'),
    ]),
    h('div.flex.justify-end.pt-2', {}, [
      h('button.btn-danger.h-10', { onclick: () => signOut() }, ['Sign out']),
    ]),
  ]);

  return appShell(
    h('div.max-w-2xl.mx-auto.w-full.flex.flex-col.gap-4', {}, [
      h('h1.text-3xl.font-semibold.heading-grad', {}, ['Profile']),
      card,
    ])
  );
}

function stat(label, value, color = 'text-white') {
  return h('div.glass.p-3.flex.flex-col.gap-1', {}, [
    h('span.text-[10px].text-muted.uppercase.tracking-widest', {}, [label]),
    h(`span.${color}.font-mono.text-lg.tabular-nums`, {}, [value]),
  ]);
}
