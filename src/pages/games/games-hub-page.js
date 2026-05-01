/**
 * games-hub-page.js
 * Live grid of games. Each card shows its current rotation status:
 *   - "X h Y m left"  for games currently in the active 6-game rotation
 *   - "Returns soon"  for pool games that are out of rotation (locked,
 *                     non-clickable, dimmed)
 *
 * The 6-game rotation is fetched from `get_active_games()` on the server
 * (see v7 migration). The rotation refreshes itself lazily on every read
 * so just rendering this page advances the cycle when due.
 *
 * Multiplayer + Emoji Hunt are always-on: they're not part of the rotation
 * pool because they aren't "offline" games in the user's framing.
 */
import { h, mount } from '../../utils/dom.js';
import { appShell } from '../../ui/layout/app-shell.js';
import { ROUTES } from '../../config/constants.js';
import { getActiveGames, GAME_ID_TO_ROUTE } from '../../services/game-rotation.js';
import { spinner } from '../../ui/components/spinner.js';
import { isAdmin } from '../../state/user-store.js';

// Static card metadata, keyed by rotation game id (from `game_pool()` in v7).
const ROTATING = {
  coinflip:  { title: 'Coinflip',  desc: 'Heads or tails — instant 1.95× payout.',     icon: '🪙', grad: 'from-accent-amber/40 to-accent-rose/40' },
  dice:      { title: 'Dice',      desc: 'Pick your win chance. Set your multiplier.', icon: '🎲', grad: 'from-accent-lime/40 to-accent-cyan/40' },
  roulette:  { title: 'Roulette',  desc: 'European single-zero. Stack your chips.',    icon: '🎡', grad: 'from-accent-rose/40 to-accent-violet/40' },
  blackjack: { title: 'Blackjack', desc: 'Hit, stand, beat the dealer to 21.',         icon: '🃏', grad: 'from-accent-violet/40 to-accent-magenta/40' },
  crash:     { title: 'Crash',     desc: 'Cash out before the rocket explodes.',       icon: '🚀', grad: 'from-accent-magenta/40 to-accent-cyan/40' },
  cases:     { title: 'Cases',     desc: 'Bronze, silver, gold. Pity + golden keys.',  icon: '📦', grad: 'from-accent-amber/40 to-accent-rose/40' },
  gacha:     { title: 'Gacha',     desc: 'Pull the wheel. Chase one-of-one cosmetics.', icon: '🎰', grad: 'from-accent-cyan/40 to-accent-violet/40' },
  mines:     { title: 'Mines',     desc: 'Pick safe tiles, stack multiplier, cash out before the boom.', icon: '💣', grad: 'from-accent-rose/40 to-accent-amber/40' },
  candy:     { title: 'Candy',     desc: 'Match-3 cascades. Chain clears for runaway payouts.',         icon: '🍬', grad: 'from-accent-magenta/40 to-accent-lime/40' },
  plinko:    { title: 'Plinko',    desc: 'Drop through pegs, land in a multiplier. Pure tension.',      icon: '🔴', grad: 'from-accent-cyan/40 to-accent-rose/40' },
  lottery:   { title: 'Neon Lotto', desc: 'Pick 5 lucky numbers. Match drawn balls for up to 8,000×.',   icon: '🎱', grad: 'from-accent-lime/40 to-accent-violet/40' },
};

// Always-on games (not part of the rotation), shown beneath the rotating row.
const ALWAYS_ON = [
  { to: ROUTES.EMOJI_HUNT, title: 'Emoji hunt',  desc: 'Spot the emoji floating on the site. First click wins.', icon: '👀', grad: 'from-accent-cyan/40 to-accent-lime/40' },
  { to: ROUTES.LOBBY,      title: 'Multiplayer', desc: 'Chaos TTT, Fade TTT — ante up, winner takes all.',       icon: '⚔️', grad: 'from-accent-violet/40 to-accent-cyan/40' },
];

export function renderGamesHub(ctx) {
  const root = h('div.flex.flex-col.gap-6', {}, []);
  let countdownTimer = null;
  ctx.onCleanup(() => { if (countdownTimer) clearInterval(countdownTimer); });

  /** @type {Array<{gameId:string, endsAt:Date}>} */
  let active = [];
  let loading = true;
  // If the rotation fetch returned zero rows (either because v7 isn't
  // applied yet, the server hasn't seeded, or a transient RPC failure),
  // we flip into "unknown rotation" mode and render every pool game as
  // available. This keeps the hub usable instead of showing a wall of
  // locked cards when the rotation table simply isn't readable.
  let rotationUnknown = false;

  const redraw = () => mount(root, view());

  function view() {
    return h('div.flex.flex-col.gap-6', {}, [
      h('div.flex.items-end.justify-between.gap-3.flex-wrap', {}, [
        h('div', {}, [
          h('h1.text-3xl.font-semibold.heading-grad', {}, ['Games']),
          h('p.text-sm.text-muted', {}, [
            'Six offline games are open at any time. Two rotate every two hours — once a game leaves rotation, it locks until its next slot.',
          ]),
        ]),
        loading
          ? h('div.text-xs.text-muted.flex.items-center.gap-2', {}, [spinner(), 'Loading rotation…'])
          : rotationUnknown
          ? h('div.text-xs.text-accent-amber.font-mono', {}, ['rotation data unavailable — all games open'])
          : h('div.text-xs.text-muted.font-mono', {}, [`${active.length} / 6 active`]),
      ]),

      // Rotating row.
      //
      // For non-admins we only render the cards that are currently active
      // (or every pool game when rotation data is unknown). Locked cards
      // are simply hidden — there's nothing actionable on them, and seeing
      // a wall of greyed-out games communicates "the site is broken" more
      // than "rotation". Admins still see every card with an ADMIN badge
      // on the locked ones so they can verify rotation behaviour.
      h('section.flex.flex-col.gap-3', {}, [
        h('h2.text-xs.text-muted.uppercase.tracking-widest', {}, ['In rotation']),
        h(
          'div.grid.grid-cols-1.sm:grid-cols-2.lg:grid-cols-3.gap-4',
          {},
          Object.keys(ROTATING)
            .map((gameId) => {
              const slot = active.find((a) => a.gameId === gameId);
              const hasSlot = !!slot && slot.endsAt.getTime() > Date.now();
              const visible = hasSlot || rotationUnknown || isAdmin();
              if (!visible) return null;
              return rotatingCard(gameId, slot);
            })
            .filter(Boolean)
        ),
      ]),

      // Always-on row
      h('section.flex.flex-col.gap-3', {}, [
        h('h2.text-xs.text-muted.uppercase.tracking-widest', {}, ['Always on']),
        h(
          'div.grid.grid-cols-1.sm:grid-cols-2.lg:grid-cols-3.gap-4',
          {},
          ALWAYS_ON.map(staticCard)
        ),
      ]),

      h('p.text-[11px].text-muted.max-w-3xl', {}, [
        'House edges: dice/crash/plinko ~3% · coinflip 2.5% · roulette 2.7% · blackjack varies by play · cases tier-dependent · gacha ~5%. Every roll, card and pull is decided server-side.',
      ]),
    ]);
  }

  function rotatingCard(gameId, slot) {
    const meta = ROTATING[gameId];
    const route = GAME_ID_TO_ROUTE[gameId];
    // When the rotation data is unknown (404, empty table, cold boot) we
    // don't want to lock every card. Fall through to the "active" branch
    // but render it without a countdown so the user still has a usable UI.
    const hasSlot  = !!slot && slot.endsAt.getTime() > Date.now();
    const isActive = hasSlot || rotationUnknown;
    const remaining = hasSlot ? formatRemaining(slot.endsAt) : null;

    if (isActive) {
      return h(
        'a.relative.glass.neon-border.p-6.flex.flex-col.gap-3.h-full.overflow-hidden.transition.hover:-translate-y-1.hover:shadow-glow',
        { href: route, 'data-link': '' },
        [
          h(`div.absolute.inset-0.opacity-50.bg-gradient-to-br.${meta.grad}.pointer-events-none`, {}, []),
          h('div.relative.flex.items-center.justify-between', {}, [
            h('span.text-4xl', {}, [meta.icon]),
            h('span.text-xs.text-accent-lime.uppercase.tracking-widest.font-mono', {}, [
              remaining ? remaining + ' left' : 'Play →',
            ]),
          ]),
          h('div.relative.flex.flex-col.gap-1', {}, [
            h('div.font-semibold.text-xl', {}, [meta.title]),
            h('div.text-sm.text-white/70', {}, [meta.desc]),
          ]),
        ]
      );
    }

    // Locked card — only ever rendered for admins (the non-admin path
    // filters this card out one level up). Admins get a clickable card
    // with a small ADMIN badge so they can still test the page.
    const adminVisible = isAdmin();
    return h(
      adminVisible
        ? 'a.relative.glass.neon-border.p-6.flex.flex-col.gap-3.h-full.overflow-hidden.opacity-70.transition.hover:-translate-y-1.hover:shadow-glow'
        : 'div.relative.glass.neon-border.p-6.flex.flex-col.gap-3.h-full.overflow-hidden.opacity-40.cursor-not-allowed',
      adminVisible
        ? { href: route, 'data-link': '', title: 'Out of rotation — admin bypass' }
        : { title: 'Currently out of rotation' },
      [
        h(`div.absolute.inset-0.opacity-30.bg-gradient-to-br.${meta.grad}.pointer-events-none`, {}, []),
        h('div.relative.flex.items-center.justify-between', {}, [
          h('span.text-4xl.grayscale', {}, [meta.icon]),
          adminVisible
            ? h('span.text-[10px].text-accent-magenta.uppercase.tracking-widest.font-mono.px-1.5.py-0.5.rounded.border.border-accent-magenta/40.bg-accent-magenta/10', {}, ['Admin · locked'])
            : h('span.text-xs.text-muted.uppercase.tracking-widest.font-mono', {}, ['Locked']),
        ]),
        h('div.relative.flex.flex-col.gap-1', {}, [
          h('div.font-semibold.text-xl', {}, [meta.title]),
          h('div.text-sm.text-white/60', {}, [meta.desc]),
          h('div.text-[11px].text-muted.font-mono.mt-1', {}, ['Returns soon — every 2 h.']),
        ]),
      ]
    );
  }

  function staticCard(c) {
    return h(
      'a.relative.glass.neon-border.p-6.flex.flex-col.gap-3.h-full.overflow-hidden.transition.hover:-translate-y-1.hover:shadow-glow',
      { href: c.to, 'data-link': '' },
      [
        h(`div.absolute.inset-0.opacity-50.bg-gradient-to-br.${c.grad}.pointer-events-none`, {}, []),
        h('div.relative.flex.items-center.justify-between', {}, [
          h('span.text-4xl', {}, [c.icon]),
          h('span.text-xs.text-muted.uppercase.tracking-widest', {}, ['Play →']),
        ]),
        h('div.relative.flex.flex-col.gap-1', {}, [
          h('div.font-semibold.text-xl', {}, [c.title]),
          h('div.text-sm.text-white/70', {}, [c.desc]),
        ]),
      ]
    );
  }

  // Initial draw + first fetch.
  redraw();
  const loadRotation = () =>
    getActiveGames({ force: true })
      .then((rows) => {
        active = rows;
        rotationUnknown = rows.length === 0;
        loading = false;
        redraw();
      })
      .catch(() => {
        rotationUnknown = true;
        loading = false;
        redraw();
      });
  loadRotation();

  // Two tickers:
  //   * every 30s redraw so countdowns decrement live on the cards.
  //   * every 60s refetch the rotation so new slots appear as they
  //     rotate in (the DB function lazily rotates on read, so calling
  //     it also nudges the cycle forward for everyone).
  countdownTimer = setInterval(() => {
    if (active.length) redraw();
  }, 30_000);
  const refetchTimer = setInterval(loadRotation, 60_000);
  ctx.onCleanup(() => clearInterval(refetchTimer));

  return appShell(root);
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
