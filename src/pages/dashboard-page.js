/**
 * dashboard-page.js
 * Landing page after sign-in: welcome, daily-claim, quick stats and feature
 * cards into events and games.
 */
import { h } from '../utils/dom.js';
import { appShell } from '../ui/layout/app-shell.js';
import { userStore, patchProfile } from '../state/user-store.js';
import { ROUTES } from '../config/constants.js';
import { canClaimToday, claimDailyCredits } from '../services/daily-claim.js';
import { toast, toastError, toastSuccess } from '../ui/components/toast.js';
import { formatCredits, shortName } from '../utils/format.js';

export function renderDashboard() {
  const profile = userStore.get().profile;
  const name = shortName(profile?.display_name, profile?.email).split(/[\s.]/)[0];

  const claim = createClaimCard();
  const stats = createStatsCard();
  const features = createFeatureGrid();

  const greeting = h('section.flex.flex-col.gap-1', {}, [
    h('div.text-xs.tracking-[0.3em].text-accent-cyan/80.uppercase', {}, ['Welcome back']),
    h('h1.text-4xl.md:text-5xl.font-semibold.heading-grad.tracking-tight', {}, [name]),
    h('p.text-white/60', {}, ['Place your bets, win the day.']),
  ]);

  const top = h('div.grid.grid-cols-1.lg:grid-cols-3.gap-4', {}, [
    h('div.lg:col-span-2', {}, [claim]),
    stats,
  ]);

  const content = h('div.flex.flex-col.gap-8', {}, [greeting, top, features]);
  return appShell(content);
}

function createClaimCard() {
  const profile = userStore.get().profile;
  const claimable = canClaimToday(profile);

  const btn = h(
    `button.${claimable ? 'btn-primary' : 'btn-ghost'}.h-11.px-6.text-sm.font-semibold`,
    {
      disabled: !claimable,
      onclick: async () => {
        btn.disabled = true;
        try {
          const r = await claimDailyCredits();
          patchProfile({ credits: r.newBalance, streak_days: r.streak, last_claim_date: new Date().toISOString().slice(0, 10) });
          toastSuccess(`+${r.awarded} credits — streak ${r.streak}!`);
          btn.replaceChildren(document.createTextNode('Claimed today'));
          btn.classList.remove('btn-primary');
          btn.classList.add('btn-ghost');
        } catch (e) {
          toastError(e.message || 'Could not claim');
          btn.disabled = false;
        }
      },
    },
    [claimable ? '✦ Claim daily credits' : 'Claimed today']
  );

  return h(
    'div.glass.neon-border.p-6.flex.flex-col.gap-4.relative.overflow-hidden',
    {},
    [
      h('div.absolute.-right-12.-top-12.w-48.h-48.rounded-full.bg-accent-violet/30.blur-3xl', {}, []),
      h('div.flex.items-center.justify-between.gap-4.flex-wrap', {}, [
        h('div.flex.flex-col.gap-1', {}, [
          h('div.text-xs.text-muted.uppercase.tracking-widest', {}, ['Daily reward']),
          h('div.text-2xl.font-semibold', {}, [
            '100 credits ',
            h('span.text-accent-cyan.text-base', {}, [
              `+ ${Math.min((profile?.streak_days ?? 0) * 10 + 10, 100)} streak bonus`,
            ]),
          ]),
          h('div.text-sm.text-white/60', {}, [
            `Current streak: ${profile?.streak_days ?? 0} day${(profile?.streak_days ?? 0) === 1 ? '' : 's'}`,
          ]),
        ]),
        btn,
      ]),
    ]
  );
}

function createStatsCard() {
  const p = userStore.get().profile;
  const item = (label, value, color = 'text-accent-cyan') =>
    h('div.flex.justify-between.items-baseline.gap-3', {}, [
      h('span.text-muted.text-xs.uppercase.tracking-widest', {}, [label]),
      h(`span.${color}.font-mono.text-lg.tabular-nums`, {}, [value]),
    ]);
  return h('div.glass.neon-border.p-6.flex.flex-col.gap-3', {}, [
    h('div.text-xs.text-muted.uppercase.tracking-widest', {}, ['Your stats']),
    item('Balance', formatCredits(p?.credits ?? 0)),
    item('Total wagered', formatCredits(p?.total_wagered ?? 0), 'text-white/80'),
    item('Total won', formatCredits(p?.total_won ?? 0), 'text-accent-lime'),
  ]);
}

function createFeatureGrid() {
  const features = [
    {
      to: ROUTES.EVENTS,
      title: 'Custom events',
      desc: 'Bet on whatever happens in real life. Create or join.',
      grad: 'from-accent-cyan/30 to-accent-violet/30',
      icon: '🎯',
    },
    {
      to: ROUTES.ROULETTE,
      title: 'Roulette',
      desc: 'Spin the wheel. Red, black, or zero?',
      grad: 'from-accent-rose/30 to-accent-amber/30',
      icon: '🎡',
    },
    {
      to: ROUTES.CRASH,
      title: 'Crash',
      desc: 'Cash out before the rocket explodes.',
      grad: 'from-accent-magenta/30 to-accent-violet/30',
      icon: '🚀',
    },
    {
      to: ROUTES.COINFLIP,
      title: 'Coinflip',
      desc: 'Heads or tails. 1.95× payout.',
      grad: 'from-accent-amber/30 to-accent-lime/30',
      icon: '🪙',
    },
    {
      to: ROUTES.DICE,
      title: 'Dice',
      desc: 'Set your odds. Higher risk, higher payout.',
      grad: 'from-accent-lime/30 to-accent-cyan/30',
      icon: '🎲',
    },
    {
      to: ROUTES.BLACKJACK,
      title: 'Blackjack',
      desc: 'Beat the dealer to 21.',
      grad: 'from-accent-violet/30 to-accent-magenta/30',
      icon: '🃏',
    },
    {
      to: ROUTES.EMOJI_HUNT,
      title: 'Emoji hunt',
      desc: 'Spot the emoji on the site to grab credits.',
      grad: 'from-accent-cyan/30 to-accent-magenta/30',
      icon: '👀',
    },
    {
      to: ROUTES.LEADERBOARD,
      title: 'Leaderboard',
      desc: 'Who is on top this week?',
      grad: 'from-accent-amber/30 to-accent-rose/30',
      icon: '🏆',
    },
  ];

  return h(
    'section.grid.grid-cols-1.sm:grid-cols-2.lg:grid-cols-4.gap-4',
    {},
    features.map((f) =>
      h(
        `a.relative.glass.neon-border.p-5.flex.flex-col.gap-3.h-full.transition.hover:-translate-y-0.5.hover:shadow-glow.overflow-hidden`,
        { href: f.to, 'data-link': '' },
        [
          h(
            `div.absolute.inset-0.opacity-50.bg-gradient-to-br.${f.grad}.pointer-events-none`,
            {},
            []
          ),
          h('div.relative.flex.items-center.justify-between', {}, [
            h('span.text-3xl', {}, [f.icon]),
            h('span.text-xs.text-muted.uppercase.tracking-widest', {}, ['Open →']),
          ]),
          h('div.relative.flex.flex-col.gap-1', {}, [
            h('div.font-semibold.text-lg', {}, [f.title]),
            h('div.text-xs.text-white/60', {}, [f.desc]),
          ]),
        ]
      )
    )
  );
}
