/**
 * credit-badge.js
 * Live credit pill that subscribes to userStore changes.
 */
import { h } from '../../utils/dom.js';
import { userStore } from '../../state/user-store.js';
import { formatCredits } from '../../utils/format.js';

export function createCreditBadge() {
  const amountEl = h('span.font-mono.font-semibold.tabular-nums', {}, ['0']);
  const wrap = h(
    'a.flex.items-center.gap-2.px-3.py-1.5.rounded-full.glass.neon-border.text-sm.transition.hover:scale-[1.02]',
    { href: '/profile', 'data-link': '' },
    [h('span.text-accent-cyan', {}, ['◆']), amountEl, h('span.text-muted.text-xs', {}, ['cr'])]
  );
  let last = -1;
  const update = () => {
    const c = userStore.get().profile?.credits ?? 0;
    if (c === last) return;
    amountEl.textContent = formatCredits(c);
    if (last !== -1) {
      const up = c > last;
      wrap.animate(
        [
          { boxShadow: 'none' },
          {
            boxShadow: up
              ? '0 0 24px rgba(163,255,60,0.55)'
              : '0 0 24px rgba(255,77,109,0.55)',
          },
          { boxShadow: 'none' },
        ],
        { duration: 700, easing: 'ease-out' }
      );
    }
    last = c;
  };
  update();
  const off = userStore.subscribe(update);
  return { el: wrap, dispose: off };
}
