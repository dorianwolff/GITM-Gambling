/**
 * create-event-page.js
 * Form for users to create a new betting event. RPC enforces 1/day for non-admins.
 */
import { h } from '../utils/dom.js';
import { appShell } from '../ui/layout/app-shell.js';
import { ROUTES, LIMITS } from '../config/constants.js';
import { validateEventDraft } from '../utils/validation.js';
import { createEvent } from '../services/events-service.js';
import { toastError, toastSuccess } from '../ui/components/toast.js';
import { formatDateTimeLocal } from '../utils/dates.js';

export function renderCreateEvent(ctx) {
  const titleInput = h('input.input', { placeholder: 'e.g. Will M. Dupont say "voilà" today?' });
  const descInput = h('textarea.input.min-h-[100px].resize-y', {
    placeholder: 'Optional context, rules, etc.',
  });
  const closesInput = h('input.input', {
    type: 'datetime-local',
    value: formatDateTimeLocal(new Date(Date.now() + 60 * 60 * 1000)),
  });

  const optionInputs = [];
  const optionsWrap = h('div.flex.flex-col.gap-2', {}, []);

  const addOption = (val = '') => {
    if (optionInputs.length >= LIMITS.EVENT_OPTIONS_MAX) return;
    const idx = optionInputs.length;
    const inp = h('input.input.flex-1', {
      placeholder: `Option ${idx + 1}`,
      value: val,
    });
    const removeBtn = h(
      'button.btn-ghost.h-10.px-3.text-xs',
      {
        type: 'button',
        onclick: () => {
          const i = optionInputs.indexOf(inp);
          if (i >= 0) {
            optionInputs.splice(i, 1);
            row.remove();
          }
          if (optionInputs.length < LIMITS.EVENT_OPTIONS_MIN) addBtn.disabled = false;
        },
      },
      ['Remove']
    );
    const row = h('div.flex.gap-2', {}, [inp, removeBtn]);
    optionsWrap.appendChild(row);
    optionInputs.push(inp);
  };

  const addBtn = h(
    'button.btn-ghost.h-9.text-xs',
    {
      type: 'button',
      onclick: () => addOption(),
    },
    ['+ Add option']
  );

  // start with two
  addOption('Yes');
  addOption('No');

  const errBox = h('div.text-sm.text-accent-rose.min-h-[20px]', {}, []);

  const submit = h(
    'button.btn-primary.h-11.px-6',
    {
      onclick: async () => {
        errBox.textContent = '';
        const draft = {
          title: titleInput.value,
          description: descInput.value,
          options: optionInputs.map((i) => i.value),
          closesAt: closesInput.value,
        };
        const v = validateEventDraft(draft);
        if (!v.ok) {
          errBox.textContent = Object.values(v.errors).join(' · ');
          return;
        }
        submit.disabled = true;
        try {
          const id = await createEvent(v.sanitized);
          toastSuccess('Event created');
          ctx.navigate(`/events/${id}`);
        } catch (e) {
          toastError(e.message);
          submit.disabled = false;
        }
      },
    },
    ['Create event']
  );

  const card = h('div.glass.neon-border.p-6.flex.flex-col.gap-5', {}, [
    field('Title', titleInput, `${LIMITS.EVENT_TITLE_MIN}–${LIMITS.EVENT_TITLE_MAX} characters`),
    field('Description', descInput, 'Optional · max 1000 chars'),
    field('Closes at', closesInput, 'Bets close at this time. Resolution unlocks after.'),
    h('div.flex.flex-col.gap-2', {}, [
      h('label.text-xs.text-muted.uppercase.tracking-widest', {}, [
        `Options (${LIMITS.EVENT_OPTIONS_MIN}–${LIMITS.EVENT_OPTIONS_MAX})`,
      ]),
      optionsWrap,
      h('div', {}, [addBtn]),
    ]),
    errBox,
    h('div.flex.justify-end.gap-2', {}, [
      h('a.btn-ghost.h-11.px-4', { href: ROUTES.EVENTS, 'data-link': '' }, ['Cancel']),
      submit,
    ]),
  ]);

  return appShell(
    h('div.max-w-2xl.mx-auto.w-full.flex.flex-col.gap-4', {}, [
      h('h1.text-3xl.font-semibold.heading-grad', {}, ['Create event']),
      h('p.text-sm.text-muted', {}, [
        'Non-admins may create one event per day. Pool resolution distributes winnings pro-rata after a 5% house fee.',
      ]),
      card,
    ])
  );
}

function field(label, input, hint) {
  return h('div.flex.flex-col.gap-1.5', {}, [
    h('label.text-xs.text-muted.uppercase.tracking-widest', {}, [label]),
    input,
    hint ? h('div.text-[11px].text-muted', {}, [hint]) : null,
  ]);
}
