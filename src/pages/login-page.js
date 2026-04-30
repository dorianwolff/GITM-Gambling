/**
 * login-page.js
 * Single-button Microsoft sign-in. Inspired by sigambling.fr's clean
 * gradient-card login layout.
 */
import { h } from '../utils/dom.js';
import { signInWithMicrosoft } from '../auth/auth-service.js';
import { toastError } from '../ui/components/toast.js';
import { spinner } from '../ui/components/spinner.js';
import { env } from '../config/env.js';

export function renderLogin() {
  let busy = false;

  const btnLabel = h('span', {}, ['Continue with Microsoft']);
  const btn = h(
    'button.btn-primary.w-full.h-12.text-base.gap-3',
    {
      onclick: async () => {
        if (busy) return;
        busy = true;
        btn.replaceChildren(spinner(20), document.createTextNode(' Redirecting…'));
        try {
          await signInWithMicrosoft();
        } catch (e) {
          toastError(e.message || 'Sign-in failed');
          btn.replaceChildren(msIcon(), btnLabel);
          busy = false;
        }
      },
    },
    [msIcon(), btnLabel]
  );

  const card = h(
    'div.glass.neon-border.p-8.w-full.max-w-md.flex.flex-col.gap-6',
    {},
    [
      h('div.flex.flex-col.gap-2', {}, [
        h(
          'div.inline-flex.w-12.h-12.rounded-2xl.bg-gradient-to-br.from-accent-cyan.to-accent-magenta.shadow-glow.items-center.justify-center.text-2xl',
          {},
          ['◆']
        ),
        h('h1.text-3xl.font-semibold.heading-grad.tracking-tight', {}, ['Welcome to GITM']),
        h('p.text-sm.text-white/70', {}, [
          'Social credit gambling for ',
          h('span.text-accent-cyan.font-mono', {}, [
            env.ALLOWED_EMAIL_DOMAINS.map((d) => '@' + d).join(', '),
          ]),
          '. No real money — pure thrill.',
        ]),
      ]),

      btn,

      h('div.text-xs.text-muted.flex.flex-col.gap-1', {}, [
        h('div', {}, ['• Daily free credits'] ),
        h('div', {}, ['• Mini-games & roulette'] ),
        h('div', {}, ['• Custom betting events'] ),
        h('div', {}, ['• Hidden emoji hunts'] ),
      ]),

      h('div.text-[10px].text-muted/80.pt-3.border-t.border-white/5', {}, [
        'By continuing you confirm this is for entertainment only. ',
        'Outcomes are server-resolved. No real currency is involved.',
      ]),
    ]
  );

  const wrap = h(
    'div.min-h-screen.grid.place-items-center.p-4.relative.overflow-hidden',
    {},
    [
      h(
        'div.absolute.inset-0.bg-mesh-1.opacity-40.blur-3xl.animate-pulse-slow.pointer-events-none',
        {},
        []
      ),
      card,
    ]
  );

  return wrap;
}

function msIcon() {
  // Microsoft logo (4 squares)
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 21 21');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.innerHTML =
    '<rect x="1" y="1" width="9" height="9" fill="#F25022"/>' +
    '<rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>' +
    '<rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>' +
    '<rect x="11" y="11" width="9" height="9" fill="#FFB900"/>';
  return svg;
}
