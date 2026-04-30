/**
 * games-hub-page.js
 * Grid of games. Each card has its own gradient and accent.
 */
import { h } from '../../utils/dom.js';
import { appShell } from '../../ui/layout/app-shell.js';
import { ROUTES } from '../../config/constants.js';

const CARDS = [
  {
    to: ROUTES.COINFLIP,
    title: 'Coinflip',
    desc: 'Heads or tails — instant 1.95× payout.',
    icon: '🪙',
    grad: 'from-accent-amber/40 to-accent-rose/40',
  },
  {
    to: ROUTES.DICE,
    title: 'Dice',
    desc: 'Pick your win chance. Set your own multiplier.',
    icon: '🎲',
    grad: 'from-accent-lime/40 to-accent-cyan/40',
  },
  {
    to: ROUTES.ROULETTE,
    title: 'Roulette',
    desc: 'European single-zero. Stack your chips.',
    icon: '🎡',
    grad: 'from-accent-rose/40 to-accent-violet/40',
  },
  {
    to: ROUTES.BLACKJACK,
    title: 'Blackjack',
    desc: 'Hit, stand and beat the dealer to 21.',
    icon: '🃏',
    grad: 'from-accent-violet/40 to-accent-magenta/40',
  },
  {
    to: ROUTES.CRASH,
    title: 'Crash',
    desc: 'Cash out before the rocket explodes.',
    icon: '🚀',
    grad: 'from-accent-magenta/40 to-accent-cyan/40',
  },
  {
    to: ROUTES.EMOJI_HUNT,
    title: 'Emoji hunt',
    desc: 'Spot the emoji floating on the site. First click wins.',
    icon: '👀',
    grad: 'from-accent-cyan/40 to-accent-lime/40',
  },
  {
    to: ROUTES.CASE,
    title: 'Cases',
    desc: 'Bronze, silver, gold. Pity counter + golden keys.',
    icon: '📦',
    grad: 'from-accent-amber/40 to-accent-rose/40',
  },
  {
    to: ROUTES.LOBBY,
    title: 'Multiplayer',
    desc: 'Chaos TTT, Fade TTT — ante up, winner takes 95%.',
    icon: '⚔️',
    grad: 'from-accent-violet/40 to-accent-cyan/40',
  },
];

export function renderGamesHub() {
  const content = h('div.flex.flex-col.gap-4', {}, [
    h('h1.text-3xl.font-semibold.heading-grad', {}, ['Games']),
    h('p.text-sm.text-muted', {}, [
      'Every outcome is decided server-side. House edge ~3% on dice/crash, 2.5% coinflip, 2.7% roulette.',
    ]),
    h(
      'div.grid.grid-cols-1.sm:grid-cols-2.lg:grid-cols-3.gap-4',
      {},
      CARDS.map((c) =>
        h(
          'a.relative.glass.neon-border.p-6.flex.flex-col.gap-3.h-full.overflow-hidden.transition.hover:-translate-y-1.hover:shadow-glow',
          { href: c.to, 'data-link': '' },
          [
            h(
              `div.absolute.inset-0.opacity-50.bg-gradient-to-br.${c.grad}.pointer-events-none`,
              {},
              []
            ),
            h('div.relative.flex.items-center.justify-between', {}, [
              h('span.text-4xl', {}, [c.icon]),
              h('span.text-xs.text-muted.uppercase.tracking-widest', {}, ['Play →']),
            ]),
            h('div.relative.flex.flex-col.gap-1', {}, [
              h('div.font-semibold.text-xl', {}, [c.title]),
              h('div.text-sm.text-white/70', {}, [c.desc]),
            ]),
          ]
        )
      )
    ),
  ]);

  return appShell(content);
}
