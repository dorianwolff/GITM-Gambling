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

  // --- Mobile hamburger + slide-down drawer ---------------------------------
  // On <md the top links collapse behind a hamburger. Drawer closes on any
  // link tap (so client-router navigations don't leave it open), on outside
  // click, and on route change via our data-link delegation.
  const burger = h(
    'button.md:hidden.w-9.h-9.rounded-lg.flex.items-center.justify-center.text-white/80.hover:bg-white/[0.06].transition',
    { 'aria-label': 'Open menu', 'aria-expanded': 'false' },
    [
      h('span.block.w-5.h-[2px].bg-current.relative', {}, [
        // CSS-drawn 3-line icon via pseudo-looking spans (no icon lib).
        h('span.absolute.-top-[6px].left-0.w-5.h-[2px].bg-current', {}, []),
        h('span.absolute.top-[6px].left-0.w-5.h-[2px].bg-current', {}, []),
      ]),
    ]
  );

  const drawer = h(
    'div.md:hidden.absolute.left-0.right-0.top-16.origin-top.transition-all.duration-150',
    { style: 'pointer-events:none; transform:scaleY(0); opacity:0;' },
    [
      h(
        // Opaque drawer: `glass` was too transparent on mobile — the page
        // bled through the menu (see screenshot). Swap to a solid panel
        // (bg-bg-900) + a subtle border and a backdrop-blur fallback.
        'nav.mx-4.rounded-2xl.border.border-white/10.bg-bg-900.shadow-2xl.shadow-black/60.p-2.flex.flex-col.gap-1',
        {},
        LINKS.map((l) =>
          h(
            'a.px-3.py-3.text-sm.font-medium.text-white/90.hover:text-white.rounded-lg.hover:bg-white/[0.08]',
            { href: l.href, 'data-link': '' },
            [l.label]
          )
        )
      ),
    ]
  );
  const setDrawer = (open) => {
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    drawer.style.pointerEvents = open ? 'auto' : 'none';
    drawer.style.transform = open ? 'scaleY(1)' : 'scaleY(0)';
    drawer.style.opacity = open ? '1' : '0';
  };
  burger.addEventListener('click', (e) => {
    e.stopPropagation();
    setDrawer(burger.getAttribute('aria-expanded') !== 'true');
  });
  // Close on any link tap inside the drawer (delegation keeps it trivial
  // even though the client router intercepts the actual navigation).
  drawer.addEventListener('click', (e) => {
    if (e.target.closest('a[data-link]')) setDrawer(false);
  });

  const badge = createCreditBadge();

  const avatar = h(
    'button.w-9.h-9.rounded-full.bg-gradient-to-br.from-accent-cyan.to-accent-violet.text-black.text-sm.font-bold.flex.items-center.justify-center.shadow-glow.hover:scale-105.transition',
    { 'aria-label': 'Account menu' },
    ['?']
  );
  const menu = h(
    // Avatar dropdown: also opaque so the page doesn't ghost through.
    'div.absolute.right-0.top-12.w-56.rounded-2xl.border.border-white/10.bg-bg-900.shadow-2xl.shadow-black/60.p-2.hidden.flex.flex-col.gap-1.z-50',
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
    'header.sticky.top-0.z-40.backdrop-blur-xl.bg-bg-900/60.border-b.border-white/[0.05].relative',
    {},
    [
      h('div.max-w-7xl.mx-auto.px-4.h-16.flex.items-center.justify-between.gap-3', {}, [
        h('div.flex.items-center.gap-3.md:gap-6', {}, [burger, brand, linksEl]),
        userBox,
      ]),
      drawer,
    ]
  );

  // Outside-click closes the drawer. We attach at document level and
  // guard by checking whether the click came from inside the bar.
  const onDocClick = (e) => {
    if (!bar.contains(e.target)) setDrawer(false);
  };
  document.addEventListener('click', onDocClick);

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
      document.removeEventListener('click', onDocClick);
    },
  };
}
