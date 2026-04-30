/**
 * history-page.js
 * Personal credit ledger.
 */
import { h, mount } from '../utils/dom.js';
import { appShell } from '../ui/layout/app-shell.js';
import { listMyTransactions, labelKind } from '../services/transactions.js';
import { formatSignedCredits, timeAgo } from '../utils/format.js';
import { spinner } from '../ui/components/spinner.js';

export function renderHistory() {
  const list = h('div.flex.flex-col.gap-2', {}, [
    h('div.flex.items-center.gap-3.text-muted', {}, [spinner(), 'Loading…']),
  ]);

  listMyTransactions({ limit: 100 })
    .then((rows) => {
      if (!rows.length) {
        mount(list, h('div.text-muted.p-6.text-center', {}, ['No transactions yet.']));
        return;
      }
      mount(
        list,
        h(
          'div.flex.flex-col.gap-2',
          {},
          rows.map((t) => {
            const positive = t.delta >= 0;
            return h('div.glass.p-3.flex.items-center.gap-4', {}, [
              h(
                `div.w-2.h-10.rounded-full.${positive ? 'bg-accent-lime' : 'bg-accent-rose'}`,
                {},
                []
              ),
              h('div.flex-1.min-w-0', {}, [
                h('div.font-medium', {}, [labelKind(t.kind)]),
                h('div.text-xs.text-muted.truncate', {}, [
                  timeAgo(t.created_at),
                  t.meta?.phase ? ` · ${t.meta.phase}` : '',
                ]),
              ]),
              h(
                `div.font-mono.${positive ? 'text-accent-lime' : 'text-accent-rose'}.text-lg.tabular-nums`,
                {},
                [formatSignedCredits(t.delta)]
              ),
              h('div.text-xs.text-muted.font-mono.w-24.text-right', {}, [
                'bal ' + t.balance_after,
              ]),
            ]);
          })
        )
      );
    })
    .catch((e) => mount(list, h('div.text-accent-rose', {}, [e.message])));

  return appShell(
    h('div.flex.flex-col.gap-4', {}, [
      h('h1.text-3xl.font-semibold.heading-grad', {}, ['History']),
      list,
    ])
  );
}
