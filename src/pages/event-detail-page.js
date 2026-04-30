/**
 * event-detail-page.js
 * Single event view with live bet ticker, options bar chart and bet form.
 * Realtime: every new bet updates the totals across all clients.
 */
import { h, mount } from '../utils/dom.js';
import { appShell } from '../ui/layout/app-shell.js';
import {
  getEvent,
  listBetsForEvent,
  placeBet,
  resolveEvent,
  subscribeToEvent,
  tallyBets,
} from '../services/events-service.js';
import { userStore, patchProfile } from '../state/user-store.js';
import { spinner } from '../ui/components/spinner.js';
import { toastError, toastSuccess } from '../ui/components/toast.js';
import { confirmModal } from '../ui/components/modal.js';
import { createBetInput } from '../ui/components/bet-input.js';
import { formatCountdown, msUntil } from '../utils/dates.js';
import { formatCredits, timeAgo } from '../utils/format.js';
import { validateBet } from '../utils/validation.js';

export function renderEventDetail(ctx) {
  const root = h('div.flex.flex-col.gap-4', {}, [
    h('div.text-muted.flex.items-center.gap-3', {}, [spinner(), 'Loading…']),
  ]);

  let evt;
  let bets = [];
  let chosenOption = null;
  const betInput = createBetInput({ value: 10 });

  const reload = async () => {
    [evt, bets] = await Promise.all([getEvent(ctx.params.id), listBetsForEvent(ctx.params.id)]);
    redraw();
  };

  const redraw = () => {
    if (!evt) return;
    mount(root, view());
  };

  reload().catch((e) => mount(root, h('div.text-accent-rose', {}, [e.message])));

  const off = subscribeToEvent(ctx.params.id, () => reload());
  ctx.onCleanup(off);

  const tick = setInterval(() => {
    document.querySelectorAll('[data-cd]').forEach((el) => {
      const t = msUntil(el.getAttribute('data-cd'));
      el.textContent = t > 0 ? formatCountdown(t) : 'Closed';
    });
  }, 1000);
  ctx.onCleanup(() => clearInterval(tick));

  function view() {
    const me = userStore.get().user;
    const isAdmin = userStore.get().profile?.is_admin;
    const isCreator = evt.creator_id === me?.id;
    const closed = evt.resolved_at != null || msUntil(evt.closes_at) <= 0;
    const canResolve =
      !evt.resolved_at && !evt.cancelled && (isAdmin || (isCreator && msUntil(evt.closes_at) <= 0));

    const { totals, counts, total } = tallyBets(bets, evt.options.length);

    const optionsList = h(
      'div.flex.flex-col.gap-2',
      {},
      evt.options.map((label, i) => {
        const pct = total ? (totals[i] / total) * 100 : 0;
        const isWinner = evt.winning_option === i;
        return h(
          `button.text-left.glass.p-4.flex.flex-col.gap-2.transition.${
            chosenOption === i ? 'border-accent-cyan/60 shadow-glow' : ''
          }${isWinner ? ' border-accent-lime/60' : ''}`,
          {
            disabled: closed,
            onclick: () => {
              chosenOption = i;
              redraw();
            },
          },
          [
            h('div.flex.items-center.justify-between.gap-3', {}, [
              h('div.font-medium', {}, [label]),
              h('div.text-xs.text-muted.font-mono', {}, [
                `${formatCredits(totals[i])} cr · ${counts[i]} bet${counts[i] === 1 ? '' : 's'}`,
              ]),
            ]),
            h('div.h-2.rounded-full.bg-white/5.overflow-hidden', {}, [
              h(
                `div.h-full.${isWinner ? 'bg-accent-lime' : 'bg-gradient-to-r from-accent-cyan to-accent-violet'}.transition-all.duration-500`,
                { style: { width: pct.toFixed(1) + '%' } },
                []
              ),
            ]),
          ]
        );
      })
    );

    const placeBtn = h(
      'button.btn-primary.h-11.px-6',
      {
        disabled: closed || chosenOption == null,
        onclick: async () => {
          const amount = betInput.get();
          const err = validateBet(amount, userStore.get().profile?.credits);
          if (err) {
            toastError(err);
            return;
          }
          placeBtn.disabled = true;
          try {
            const newBal = await placeBet(evt.id, chosenOption, amount);
            patchProfile({ credits: newBal });
            toastSuccess(`Bet placed on "${evt.options[chosenOption]}"`);
            await reload();
          } catch (e) {
            toastError(e.message);
          } finally {
            placeBtn.disabled = false;
          }
        },
      },
      [closed ? 'Closed' : chosenOption == null ? 'Pick an option' : 'Place bet']
    );

    const resolveSelect = h(
      'select.input',
      {},
      evt.options.map((o, i) => h('option', { value: String(i) }, [o]))
    );
    const resolveBtn = h(
      'button.btn-success.h-10',
      {
        onclick: async () => {
          const idx = Number(resolveSelect.value);
          const ok = await confirmModal({
            title: 'Resolve event',
            message: `Mark "${evt.options[idx]}" as the winner? This is irreversible.`,
            confirmLabel: 'Resolve',
          });
          if (!ok) return;
          try {
            await resolveEvent(evt.id, idx);
            toastSuccess('Event resolved');
            await reload();
          } catch (e) {
            toastError(e.message);
          }
        },
      },
      ['Resolve']
    );

    const myBets = bets.filter((b) => b.user_id === me?.id);

    return h('div.flex.flex-col.gap-5', {}, [
      h('a.text-xs.text-muted.hover:text-white', { href: '/events', 'data-link': '' }, [
        '← All events',
      ]),
      h('div.glass.neon-border.p-6.flex.flex-col.gap-3', {}, [
        h('div.flex.items-start.justify-between.gap-3.flex-wrap', {}, [
          h('h1.text-2xl.md:text-3xl.font-semibold.heading-grad', {}, [evt.title]),
          evt.resolved_at
            ? h(
                'span.chip.bg-accent-lime/20.border-accent-lime/40.text-accent-lime',
                {},
                ['Resolved · won: ' + evt.options[evt.winning_option]]
              )
            : closed
              ? h('span.chip.bg-accent-amber/20.border-accent-amber/40.text-accent-amber', {}, [
                  'Awaiting resolution',
                ])
              : h('span.chip.bg-accent-cyan/20.border-accent-cyan/40.text-accent-cyan', {}, [
                  h('span', { 'data-cd': evt.closes_at }, [
                    formatCountdown(msUntil(evt.closes_at)),
                  ]),
                ]),
        ]),
        evt.description ? h('p.text-sm.text-white/70.whitespace-pre-line', {}, [evt.description]) : null,
        h('div.text-xs.text-muted', {}, [
          `By ${evt.creator?.display_name ?? '?'} · ${timeAgo(evt.created_at)} · `,
          `Pool: ${formatCredits(total)} cr`,
        ]),
      ]),
      h('div.grid.grid-cols-1.lg:grid-cols-3.gap-4', {}, [
        h('div.lg:col-span-2.flex.flex-col.gap-3', {}, [
          h('h2.text-sm.text-muted.uppercase.tracking-widest', {}, ['Options']),
          optionsList,
          canResolve
            ? h('div.glass.p-4.flex.items-end.gap-2', {}, [
                h('div.flex-1.flex.flex-col.gap-1', {}, [
                  h('label.text-xs.text-muted.uppercase.tracking-widest', {}, [
                    'Resolve as winner',
                  ]),
                  resolveSelect,
                ]),
                resolveBtn,
              ])
            : null,
        ]),
        h('div.flex.flex-col.gap-3', {}, [
          closed
            ? null
            : h('div.glass.p-4.flex.flex-col.gap-3', {}, [
                h('h3.text-sm.text-muted.uppercase.tracking-widest', {}, ['Place bet']),
                betInput.el,
                placeBtn,
              ]),
          h('div.glass.p-4.flex.flex-col.gap-2', {}, [
            h('h3.text-sm.text-muted.uppercase.tracking-widest', {}, ['Live bets']),
            bets.length === 0
              ? h('div.text-muted.text-sm', {}, ['No bets yet.'])
              : h(
                  'div.flex.flex-col.gap-1.max-h-72.overflow-auto',
                  {},
                  bets.slice(0, 30).map((b) =>
                    h('div.flex.items-center.justify-between.text-sm.gap-2', {}, [
                      h('span.truncate', {}, [b.user?.display_name ?? '?']),
                      h('span.text-muted.text-xs.flex-1.truncate', {}, [
                        '→ ' + evt.options[b.option_idx],
                      ]),
                      h('span.font-mono.text-accent-cyan', {}, [formatCredits(b.amount)]),
                    ])
                  )
                ),
          ]),
          myBets.length
            ? h('div.glass.p-4.flex.flex-col.gap-2', {}, [
                h('h3.text-sm.text-muted.uppercase.tracking-widest', {}, ['Your bets']),
                ...myBets.map((b) =>
                  h('div.flex.justify-between.text-sm', {}, [
                    h('span', {}, [evt.options[b.option_idx]]),
                    h('span.font-mono.text-accent-cyan', {}, [formatCredits(b.amount) + ' cr']),
                    b.payout != null
                      ? h(
                          `span.font-mono.${b.payout > 0 ? 'text-accent-lime' : 'text-muted'}`,
                          {},
                          [b.payout > 0 ? `+${formatCredits(b.payout)}` : 'lost']
                        )
                      : null,
                  ])
                ),
              ])
            : null,
        ]),
      ]),
    ]);
  }

  return appShell(root);
}
