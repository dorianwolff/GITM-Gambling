/**
 * navbar.js
 * Top navigation bar with brand, links, credit badge and user menu.
 */
import { h } from '../../utils/dom.js';
import { ROUTES } from '../../config/constants.js';
import { userStore } from '../../state/user-store.js';
import { signOut } from '../../auth/auth-service.js';
import { initials, shortName } from '../../utils/format.js';
import { createCreditBadge } from './credit-badge.js';

const LINKS = [
  { href: ROUTES.DASHBOARD, label: 'Dashboard' },
  { href: ROUTES.EVENTS, label: 'Events' },
  { href: ROUTES.GAMES, label: 'Games' },
  { href: ROUTES.MARKET, label: 'Market' },
  { href: ROUTES.LEADERBOARD, label: 'Leaderboard' },
];

export function createNavbar() {
  const linksEl = h(
    'nav.hidden.md:flex.items-center.gap-1',
    {},
    LINKS.map((l) =>
      h(
        'a.px-3.py-2.text-sm.font-medium.text-white/70.hover:text-white.transition.rounded-lg.hover:bg-white/[0.06]',
        { href: l.href, 'data-link': '' },
        [l.label]
      )
    )
  );

  const badge = createCreditBadge();

  const avatar = h(
    'button.w-9.h-9.rounded-full.bg-gradient-to-br.from-accent-cyan.to-accent-violet.text-black.text-sm.font-bold.flex.items-center.justify-center.shadow-glow.hover:scale-105.transition',
    { 'aria-label': 'Account menu' },
    ['?']
  );
  const menu = h(
    'div.absolute.right-0.top-12.w-56.glass.neon-border.p-2.hidden.flex.flex-col.gap-1.z-50',
    {},
    [
      h(
        'a.block.px-3.py-2.text-sm.rounded-lg.hover:bg-white/[0.06]',
        { href: ROUTES.PROFILE, 'data-link': '' },
        ['Profile']
      ),
      h(
        'a.block.px-3.py-2.text-sm.rounded-lg.hover:bg-white/[0.06]',
        { href: ROUTES.HISTORY, 'data-link': '' },
        ['History']
      ),
      h('div.h-px.bg-white/10.my-1', {}, []),
      h(
        'button.text-left.px-3.py-2.text-sm.rounded-lg.hover:bg-accent-rose/10.text-accent-rose',
        { onclick: () => signOut() },
        ['Sign out']
      ),
    ]
  );
  menu.style.display = 'none';
  avatar.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.style.display = menu.style.display === 'none' ? 'flex' : 'none';
  });
  document.addEventListener('click', () => (menu.style.display = 'none'));

  const userBox = h('div.relative.flex.items-center.gap-3', {}, [badge.el, avatar, menu]);

  const brand = h(
    'a.flex.items-center.gap-2.font-semibold.text-lg.tracking-tight',
    { href: ROUTES.DASHBOARD, 'data-link': '' },
    [
      h(
        'span.inline-block.w-7.h-7.rounded-lg.bg-gradient-to-br.from-accent-cyan.to-accent-magenta.shadow-glow',
        {},
        []
      ),
      h('span.heading-grad', {}, ['GITM']),
    ]
  );

  const bar = h(
    'header.sticky.top-0.z-40.backdrop-blur-xl.bg-bg-900/60.border-b.border-white/[0.05]',
    {},
    [
      h('div.max-w-7xl.mx-auto.px-4.h-16.flex.items-center.justify-between.gap-4', {}, [
        h('div.flex.items-center.gap-6', {}, [brand, linksEl]),
        userBox,
      ]),
    ]
  );

  // populate avatar initials reactively
  const update = () => {
    const p = userStore.get().profile;
    avatar.textContent = initials(p?.display_name, p?.email);
    avatar.title = shortName(p?.display_name, p?.email);
  };
  update();
  const off = userStore.subscribe(update);

  return {
    el: bar,
    dispose() {
      off();
      badge.dispose();
    },
  };
}
