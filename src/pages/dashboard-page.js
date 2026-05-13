/**
 * dashboard-page.js
 * Landing page after sign-in: welcome, daily-claim, quick stats and feature
 * cards into events and games.
 */
import { h, mount } from '../utils/dom.js';
import { appShell } from '../ui/layout/app-shell.js';
import { userStore, patchProfile } from '../state/user-store.js';
import { ROUTES } from '../config/constants.js';
import { canClaimToday, claimDailyCredits } from '../services/daily-claim.js';
import { toast, toastError, toastSuccess } from '../ui/components/toast.js';
import { formatCredits, shortName } from '../utils/format.js';
import { listEvents } from '../services/events-service.js';
import { getActiveGames, GAME_ID_TO_ROUTE } from '../services/game-rotation.js';
import { logger } from '../lib/logger.js';

export function renderDashboard() {
  const profile = userStore.get().profile;
  const name = shortName(profile?.display_name, profile?.email).split(/[\s.]/)[0];

  const claim = createClaimCard();
  const stats = createStatsCard();
  const events = createRotatingEventsCard();
  const games = createGameGrid();

  const greeting = h('section.flex.flex-col.gap-1', {}, [
    h('div.text-xs.tracking-[0.3em].text-accent-cyan/80.uppercase', {}, ['Welcome back']),
    h('h1.text-4xl.md:text-5xl.font-semibold.heading-grad.tracking-tight', {}, [name]),
    h('p.text-white/60', {}, ['Place your bets, win the day.']),
  ]);

  const top = h('div.grid.grid-cols-1.lg:grid-cols-3.gap-4', {}, [
    h('div.lg:col-span-2', {}, [claim]),
    stats,
  ]);

  const content = h('div.flex.flex-col.gap-8', {}, [greeting, top, events, games]);
  return appShell(content);
}

// ---------------------------------------------------------------------------
// Rotating live-events card.
//
// Shows a 3-event slice of the currently-open events, cycling every
// ROTATE_MS so the dashboard feels alive without spamming RPCs. The slice
// is deterministic per clock bucket — every user sees the same three
// events in the same 15-minute window, matching how the game rotation
// behaves. No extra backend needed: we already have listEvents().
// ---------------------------------------------------------------------------
const EVENTS_VISIBLE = 3;
const ROTATE_MS = 15 * 60 * 1000; // 15 minutes

function createRotatingEventsCard() {
  const card = h('section.glass.neon-border.p-6.flex.flex-col.gap-3', {}, []);
  let events = [];
  let timer = null;

  const render = () => {
    const bucket = Math.floor(Date.now() / ROTATE_MS);
    const slice = pickRotatingSlice(events, EVENTS_VISIBLE, bucket);
    const body = slice.length === 0
      ? h('div.text-sm.text-muted', {}, ['No open events right now. Create one from the Events page.'])
      : h('div.grid.grid-cols-1.md:grid-cols-3.gap-3', {}, slice.map(eventMiniCard));
    // `mount` only accepts a single child node, so wrap the header + body
    // in a fragment-like container div before handing it over.
    mount(card, h('div.flex.flex-col.gap-3', {}, [
      h('div.flex.items-end.justify-between.gap-3.flex-wrap', {}, [
        h('div', {}, [
          h('div.text-xs.text-muted.uppercase.tracking-widest', {}, ['Live events']),
          h('div.text-lg.font-semibold', {}, ['Closing soon — place your bets']),
        ]),
        h('a.text-xs.text-accent-cyan.hover:underline',
          { href: ROUTES.EVENTS, 'data-link': '' },
          ['See all →']),
      ]),
      body,
    ]));
  };

  render();
  listEvents({ status: 'open', limit: 30 })
    .then((rows) => {
      // Only show events still in the open window: not cancelled, not
      // resolved, and closes_at in the future.
      const now = Date.now();
      events = (rows ?? []).filter((e) =>
        !e.cancelled && !e.resolved_at && new Date(e.closes_at).getTime() > now
      );
      render();
      // Rotate on a plain interval instead of realignment math: the
      // bucket key itself keeps the slice stable across clients; the
      // interval is just a nudge to re-render when the bucket flips.
      timer = setInterval(render, 30_000);
    })
    .catch((e) => logger.warn('dashboard events load failed', e));

  // Dispose when the card detaches (see app-shell MutationObserver pattern).
  const obs = new MutationObserver(() => {
    if (!document.body.contains(card)) {
      if (timer) clearInterval(timer);
      obs.disconnect();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });

  return card;
}

function eventMiniCard(e) {
  const closes = new Date(e.closes_at);
  const msLeft = closes.getTime() - Date.now();
  const label = msLeft <= 0
    ? 'closed'
    : msLeft < 60_000
      ? `${Math.floor(msLeft / 1000)}s left`
      : msLeft < 3_600_000
        ? `${Math.floor(msLeft / 60_000)}m left`
        : `${Math.floor(msLeft / 3_600_000)}h ${Math.floor((msLeft % 3_600_000) / 60_000)}m left`;
  return h(
    'a.glass.rounded-xl.p-4.flex.flex-col.gap-2.h-full.transition.hover:-translate-y-0.5.hover:shadow-glow',
    { href: `${ROUTES.EVENTS}/${e.id}`, 'data-link': '' },
    [
      h('div.text-[10px].text-accent-cyan.uppercase.tracking-widest', {}, [label]),
      h('div.font-semibold.text-sm.line-clamp-2', { style: 'min-height:2.6em' }, [e.title ?? 'Untitled event']),
      h('div.text-[11px].text-muted.line-clamp-2', {}, [e.description ?? '']),
    ]
  );
}

const ACTIVE_GAME_META = Object.freeze({
  coinflip: { title: 'Coinflip', desc: 'Heads or tails — instant 1.95× payout.', icon: '🪙', grad: 'from-accent-amber/40 to-accent-rose/40' },
  dice: { title: 'Dice', desc: 'Pick your win chance. Set your multiplier.', icon: '🎲', grad: 'from-accent-lime/40 to-accent-cyan/40' },
  roulette: { title: 'Roulette', desc: 'European single-zero. Stack your chips.', icon: '🎡', grad: 'from-accent-rose/40 to-accent-violet/40' },
  blackjack: { title: 'Blackjack', desc: 'Hit, stand, beat the dealer to 21.', icon: '🃏', grad: 'from-accent-violet/40 to-accent-magenta/40' },
  crash: { title: 'Crash', desc: 'Cash out before the rocket explodes.', icon: '🚀', grad: 'from-accent-magenta/40 to-accent-cyan/40' },
  cases: { title: 'Cases', desc: 'Bronze, silver, gold. Pity + golden keys.', icon: '📦', grad: 'from-accent-amber/40 to-accent-rose/40' },
  gacha: { title: 'Gacha', desc: 'Pull the wheel. Chase one-of-one cosmetics.', icon: '🎰', grad: 'from-accent-cyan/40 to-accent-violet/40' },
  mines: { title: 'Mines', desc: 'Pick safe tiles, stack multiplier, cash out before the boom.', icon: '💣', grad: 'from-accent-rose/40 to-accent-amber/40' },
  candy: { title: 'Candy', desc: 'Match-3 cascades. Chain clears for runaway payouts.', icon: '🍬', grad: 'from-accent-magenta/40 to-accent-lime/40' },
  plinko: { title: 'Plinko', desc: 'Drop through pegs, land in a multiplier. Pure tension.', icon: '🔴', grad: 'from-accent-cyan/40 to-accent-rose/40' },
  lottery: { title: 'Neon Lotto', desc: 'Pick 5 lucky numbers. Match drawn balls for up to 8,000×.', icon: '🎱', grad: 'from-accent-lime/40 to-accent-violet/40' },
  warfront: { title: 'Warfront', desc: 'Draft a 6-unit army, beat the enemy, and cash out by difficulty.', icon: '⚔️', grad: 'from-accent-amber/40 to-accent-violet/40' },
});

const PVP_GAME_CARDS = Object.freeze([
  {
    title: 'Chaos TTT',
    desc: 'Two-player tic-tac-toe with a random locked cell every turn.',
    icon: '🌀',
    grad: 'from-accent-violet/40 to-accent-cyan/40',
    to: ROUTES.LOBBY,
    badge: 'PvP',
  },
  {
    title: 'Fade TTT',
    desc: 'Tic-tac-toe where your oldest piece disappears after the fourth move.',
    icon: '👻',
    grad: 'from-accent-rose/40 to-accent-amber/40',
    to: ROUTES.LOBBY,
    badge: 'PvP',
  },
]);

function createGameGrid() {
  const card = h('section.glass.neon-border.p-6.flex.flex-col.gap-3', {}, []);
  let activeGames = [];
  let loading = true;

  const render = () => {
    const activeCards = activeGames.slice(0, 6).map(activeGameCard).filter(Boolean);
    const body = loading
      ? h('div.grid.grid-cols-1.sm:grid-cols-2.lg:grid-cols-4.gap-3', {}, Array.from({ length: 8 }, () => gameLoadingCard()))
      : h('div.grid.grid-cols-1.sm:grid-cols-2.lg:grid-cols-4.gap-3', {}, [
          ...activeCards,
          ...PVP_GAME_CARDS.map(pvpGameCard),
        ]);

    mount(card, h('div.flex.flex-col.gap-3', {}, [
      h('div.flex.items-end.justify-between.gap-3.flex-wrap', {}, [
        h('div', {}, [
          h('div.text-xs.text-muted.uppercase.tracking-widest', {}, ['Active games']),
          h('div.text-lg.font-semibold', {}, ['Six live games + two PvP slots']),
        ]),
        h('div.text-xs.text-muted.font-mono', {}, [loading ? 'Loading…' : `${activeCards.length} / 6 active`]),
      ]),
      body,
    ]));
  };

  render();
  getActiveGames({ force: true })
    .then((rows) => {
      activeGames = rows ?? [];
      loading = false;
      render();
    })
    .catch((e) => {
      logger.warn('dashboard active games load failed', e);
      loading = false;
      render();
    });

  return card;
}

function activeGameCard(game) {
  const meta = ACTIVE_GAME_META[game.gameId] ?? {
    title: game.gameId,
    desc: 'Open the game.',
    icon: '🎮',
    grad: 'from-accent-cyan/40 to-accent-violet/40',
  };
  const route = GAME_ID_TO_ROUTE[game.gameId] ?? ROUTES.GAMES;
  const remaining = formatRemaining(game.endsAt);

  return h(
    'a.relative.glass.neon-border.p-6.flex.flex-col.gap-3.h-full.overflow-hidden.transition.hover:-translate-y-1.hover:shadow-glow',
    { href: route, 'data-link': '' },
    [
      h(`div.absolute.inset-0.opacity-50.bg-gradient-to-br.${meta.grad}.pointer-events-none`, {}, []),
      h('div.relative.flex.items-center.justify-between', {}, [
        h('span.text-4xl', {}, [meta.icon]),
        h('span.text-xs.text-accent-lime.uppercase.tracking-widest.font-mono', {}, [
          remaining ? `${remaining} left` : 'Play →',
        ]),
      ]),
      h('div.relative.flex.flex-col.gap-1', {}, [
        h('div.font-semibold.text-xl', {}, [meta.title]),
        h('div.text-sm.text-white/70', {}, [meta.desc]),
      ]),
    ]
  );
}

function pvpGameCard(game) {
  return h(
    'a.relative.glass.neon-border.p-6.flex.flex-col.gap-3.h-full.overflow-hidden.transition.hover:-translate-y-1.hover:shadow-glow',
    { href: game.to, 'data-link': '' },
    [
      h(`div.absolute.inset-0.opacity-50.bg-gradient-to-br.${game.grad}.pointer-events-none`, {}, []),
      h('div.relative.flex.items-center.justify-between', {}, [
        h('span.text-4xl', {}, [game.icon]),
        h('span.text-xs.text-accent-cyan.uppercase.tracking-widest.font-mono', {}, [
          game.badge ?? 'PvP',
        ]),
      ]),
      h('div.relative.flex.flex-col.gap-1', {}, [
        h('div.font-semibold.text-xl', {}, [game.title]),
        h('div.text-sm.text-white/70', {}, [game.desc]),
      ]),
      h('div.relative.text-xs.text-muted.uppercase.tracking-widest.font-mono', {}, ['Open lobby →']),
    ]
  );
}

function gameLoadingCard() {
  return h('div.glass.neon-border.p-6.flex.flex-col.gap-3.h-full.overflow-hidden.animate-pulse', {}, [
    h('div.h-10.w-10.rounded-full.bg-white/10', {}, []),
    h('div.h-4.w-24.rounded-full.bg-white/10', {}, []),
    h('div.h-3.w-5/6.rounded-full.bg-white/10', {}, []),
    h('div.h-3.w-2/3.rounded-full.bg-white/10', {}, []),
  ]);
}

function formatRemaining(endsAt) {
  const ms = Math.max(0, endsAt.getTime() - Date.now());
  const totalMin = Math.round(ms / 60_000);
  if (totalMin >= 60) {
    const h_ = Math.floor(totalMin / 60);
    const m_ = totalMin % 60;
    return `${h_}h ${m_.toString().padStart(2, '0')}m`;
  }
  return `${totalMin}m`;
}

// Deterministic shuffle + slice: same `bucket` → same slice for every
// client. `mulberry32` is a 32-bit PRNG seeded by bucket so all users
// permute the same pool identically.
function pickRotatingSlice(pool, n, bucket) {
  if (!pool.length) return [];
  const seed = (bucket * 2654435761) >>> 0;
  const rand = mulberry32(seed);
  const arr = pool.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, n);
}

function mulberry32(a) {
  return function () {
    let t = (a = (a + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

  if (userStore.get().profile?.is_admin) {
    features.unshift({
      to: ROUTES.ADMIN,
      title: 'Admin panel',
      desc: 'Suspend accounts, grant credits and reset the world.',
      grad: 'from-accent-rose/30 to-accent-magenta/30',
      icon: '🛡️',
    });
  }

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
