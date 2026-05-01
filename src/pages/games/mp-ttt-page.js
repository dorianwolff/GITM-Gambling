/**
 * mp-ttt-page.js
 * Live multiplayer tic-tac-toe. Handles both variants:
 *   ttt_chaos — a random empty cell is "locked" for one turn
 *   ttt_fade  — each player only keeps their last 3 pieces
 *
 * Server authoritative. Client reads the game row, subscribes to updates,
 * and sends moves via mp_make_move.
 */
import { h, mount } from '../../utils/dom.js';
import { appShell } from '../../ui/layout/app-shell.js';
import {
  getGame,
  makeMove,
  resign,
  subscribeToGame,
  variantById,
} from '../../games/multiplayer/mp-api.js';
import { userStore, patchProfile } from '../../state/user-store.js';
import { refreshProfile } from '../../services/profile-service.js';
import { toast, toastError, toastSuccess } from '../../ui/components/toast.js';
import { formatCredits, initials, shortName } from '../../utils/format.js';
import { logger } from '../../lib/logger.js';

export function renderMpTtt(ctx) {
  const gameId = ctx.params.id;
  let game = null;
  let loading = true;
  let busy = false;

  const root = h('div.flex.flex-col.gap-4', {}, []);
  const redraw = () => mount(root, view());

  // Reload the game row. If the game just transitioned to 'done', also
  // force-refresh the profile so the payout is visible immediately even
  // if the realtime profile channel is delayed.
  async function load() {
    try {
      const prev = game?.status;
      game = await getGame(gameId);
      if (prev !== 'done' && game?.status === 'done') {
        const me = userStore.get().user;
        if (me) {
          refreshProfile(me.id)
            .then((p) => patchProfile(p))
            .catch((e) => logger.warn('profile refresh after mp end failed', e));
        }
        announceOutcome(game, userStore.get().user?.id);
      }
      loading = false;
      redraw();
    } catch (e) {
      logger.warn('mp load failed', e);
      toastError(e.message);
    }
  }

  load();
  const off = subscribeToGame(gameId, () => load());
  ctx.onCleanup(off);

  // Re-render when our own profile updates (e.g. credits change).
  const unsubProfile = userStore.subscribe(() => redraw());
  ctx.onCleanup(unsubProfile);

  async function doMove(cell) {
    if (busy) return;
    if (!game || game.status !== 'active') return;
    const me = userStore.get().user;
    const seat = seatOf(game, me?.id);
    if (seat == null) return toastError('You are a spectator');
    if (seat !== game.turn) return toastError("It's not your turn");
    busy = true;
    redraw();
    try {
      const updated = await makeMove(gameId, { cell });
      game = await enrichPlayers(updated);
      if (game.status === 'done') announceOutcome(game, me.id);
    } catch (e) {
      toastError(e.message);
    } finally {
      busy = false;
      redraw();
    }
  }

  async function doResign() {
    if (busy || !game || game.status !== 'active') return;
    if (!confirm('Resign? Your opponent takes the pot.')) return;
    busy = true;
    try {
      await resign(gameId);
    } catch (e) {
      toastError(e.message);
    } finally {
      busy = false;
    }
  }

  // ---------- view ----------
  function view() {
    if (loading) return centerNote('Loading game…');
    if (!game) return centerNote('Game not found');

    const me = userStore.get().user;
    const seat = seatOf(game, me?.id);
    const mySeatLabel = seat === 0 ? 'X' : seat === 1 ? 'O' : 'Spectator';
    const v = variantById(game.game_type);

    const board = decodeBoard(game);
    const locked = game.state?.locked ?? null;
    const faded = game.state?.faded ?? null;

    const canMove =
      game.status === 'active' && seat === game.turn && !busy;

    return h('div.flex.flex-col.gap-4', {}, [
      h('div.flex.items-center.justify-between.gap-3.flex-wrap', {}, [
        h('div', {}, [
          h('h1.text-3xl.font-semibold.heading-grad', {}, [v.name]),
          h('p.text-sm.text-muted', {}, [v.blurb]),
        ]),
        h(
          'button.btn-ghost.h-9.px-3.text-xs',
          { onclick: () => ctx.navigate('/games/lobby') },
          ['← Lobby']
        ),
      ]),

      // Players
      h('div.grid.grid-cols-1.md:grid-cols-3.gap-3', {}, [
        playerPanel(game.x, 'X', game.turn === 0 && game.status === 'active', game.winner === 0),
        h('div.glass.neon-border.p-4.flex.flex-col.items-center.justify-center.gap-1', {}, [
          h('span.text-[10px].text-muted.uppercase.tracking-widest', {}, ['Pot · winner takes all']),
          h('span.text-2xl.font-mono.font-bold.text-accent-lime', {}, [
            `${formatCredits(game.ante * 2)} cr`,
          ]),
          game.status === 'active'
            ? h(`div.text-xs.mt-1.${seat === game.turn ? 'text-accent-cyan' : 'text-muted'}`, {}, [
                seat === game.turn
                  ? 'Your turn'
                  : game.turn === 0
                    ? `${game.x?.display_name ?? 'X'}'s turn`
                    : `${game.o?.display_name ?? 'O'}'s turn`,
              ])
            : h('div.text-xs.mt-1.text-muted', {}, [statusLabel(game)]),
          mySeatLabel !== 'Spectator'
            ? h('span.text-[10px].text-muted.mt-1', {}, [`You are ${mySeatLabel}`])
            : null,
        ]),
        playerPanel(game.o, 'O', game.turn === 1 && game.status === 'active', game.winner === 1),
      ]),

      // Chaos event banner (shown when a chaos event just happened this turn)
      game.game_type === 'ttt_chaos' && game.status === 'active'
        ? chaosEventBanner(game, seat)
        : null,

      // Board
      boardView(board, locked, faded, canMove, doMove, game.game_type),

      // Variant-specific stats
      variantStatsView(game, board),

      // Footer controls
      h('div.flex.justify-between.items-center.flex-wrap.gap-3', {}, [
        h('div.text-xs.text-muted', {}, [statusLabel(game)]),
        game.status === 'active' && seat != null
          ? h('button.btn-danger.h-9.px-4.text-xs', { onclick: doResign }, ['Resign'])
          : null,
      ]),
    ]);
  }

  redraw();
  return appShell(root);
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function seatOf(game, userId) {
  if (!userId) return null;
  if (game.player_x === userId) return 0;
  if (game.player_o === userId) return 1;
  return null;
}

function decodeBoard(game) {
  const raw = game.state?.board ?? [];
  // jsonb array arrives as JS array already; defensive copy.
  return Array.isArray(raw) ? raw.slice(0, 9) : [];
}

function statusLabel(game) {
  if (game.status === 'waiting') return 'Waiting for opponent to join…';
  if (game.status === 'cancelled') return 'Cancelled';
  if (game.status === 'active') return 'In progress';
  if (game.winner === -1) return 'Draw — both refunded';
  if (game.winner === 0) return `${game.x?.display_name ?? 'X'} wins`;
  if (game.winner === 1) return `${game.o?.display_name ?? 'O'} wins`;
  return game.status;
}

function announceOutcome(game, myId) {
  const seat = seatOf(game, myId);
  if (seat == null) return;
  if (game.winner === -1) toast('Draw — ante refunded', { type: 'info' });
  else if (game.winner === seat) toastSuccess(`You won ${formatCredits(game.ante * 2)} cr`);
  else toastError('You lost.');
}

// After mp_make_move we get a bare row. Wire in stub player objects so the
// view doesn't have to re-fetch joins for a smooth re-render.
async function enrichPlayers(row) {
  // Just refetch; cheap and keeps us consistent.
  try {
    return await getGame(row.id);
  } catch (e) {
    logger.warn('enrich failed', e);
    return row;
  }
}

// ----------------------------------------------------------------------------
// View pieces
// ----------------------------------------------------------------------------

function centerNote(msg) {
  return appShell(
    h('div.flex.items-center.justify-center.py-20', {}, [
      h('span.text-muted.text-sm', {}, [msg]),
    ])
  );
}

function playerPanel(p, mark, isActive, isWinner) {
  const empty = !p;
  return h('div.glass.neon-border.p-4.flex.items-center.gap-3', {
    style: {
      border: isActive ? '2px solid #22e1ff' : isWinner ? '2px solid #3ddc7e' : undefined,
      boxShadow: isActive ? '0 0 16px rgba(34,225,255,0.3)' : isWinner ? '0 0 16px rgba(61,220,126,0.35)' : 'none',
    },
  }, [
    h(
      `div.w-12.h-12.rounded-xl.flex.items-center.justify-center.text-xl.font-bold.text-black.${
        mark === 'X' ? 'bg-accent-rose' : 'bg-accent-cyan'
      }`,
      {},
      [empty ? '…' : initials(p?.display_name, p?.email)]
    ),
    h('div.flex.flex-col.min-w-0', {}, [
      h('span.text-xs.uppercase.tracking-widest.text-muted', {}, [`Player ${mark}`]),
      h('span.text-sm.font-semibold.truncate', {}, [empty ? 'Waiting…' : shortName(p?.display_name, p?.email)]),
      isWinner ? h('span.text-xs.text-accent-lime', {}, ['Winner']) : null,
    ]),
  ]);
}

function boardView(board, locked, faded, canMove, onCell, variant) {
  return h('div.glass.neon-border.p-6.flex.justify-center', {}, [
    h(
      'div.grid.grid-cols-3.gap-2',
      {
        style: {
          width: 'min(420px, 90vw)',
          aspectRatio: '1 / 1',
        },
      },
      Array.from({ length: 9 }, (_, i) => cellView(i, board[i] ?? 0, locked === i, faded === i, canMove, onCell, variant))
    ),
  ]);
}

function cellView(i, value, isLocked, wasFaded, canMove, onCell, variant) {
  const empty = value === 0;
  const playable = empty && !isLocked && canMove;
  const label = value === 1 ? 'X' : value === 2 ? 'O' : '';
  const color = value === 1 ? '#ff2bd6' : value === 2 ? '#22e1ff' : 'transparent';

  const bg = isLocked
    ? 'repeating-linear-gradient(45deg, rgba(255,43,214,0.22) 0 10px, rgba(20,4,16,0.6) 10px 20px)'
    : 'linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))';

  return h(
    'button.relative.rounded-xl.flex.items-center.justify-center.transition-transform.overflow-hidden',
    {
      onclick: playable ? () => onCell(i) : undefined,
      disabled: !playable,
      style: {
        background: bg,
        border: `2px solid ${isLocked ? 'rgba(255,43,214,0.85)' : 'rgba(255,255,255,0.08)'}`,
        boxShadow: isLocked
          ? 'inset 0 0 20px rgba(255,43,214,0.45), 0 0 14px rgba(255,43,214,0.35)'
          : 'inset 0 0 10px rgba(0,0,0,0.4)',
        cursor: playable ? 'pointer' : 'default',
        opacity: playable || !empty || isLocked ? 1 : 0.85,
      },
    },
    [
      // Central mark / lock icon
      isLocked
        ? h('div.flex.flex-col.items-center.gap-1.pointer-events-none', {}, [
            h('span.text-5xl', {
              style: { filter: 'drop-shadow(0 0 8px rgba(255,43,214,0.8))' },
            }, ['🔒']),
            h(
              'span.text-[10px].text-accent-rose.uppercase.tracking-widest.font-bold',
              {},
              ['Locked'],
            ),
          ])
        : h(
            `span.text-6xl.font-mono.font-bold`,
            { style: { color, textShadow: color !== 'transparent' ? `0 0 18px ${color}aa` : 'none' } },
            [label]
          ),
      wasFaded && empty && !isLocked
        ? h(
            'span.absolute.top-1.left-2.text-[10px].text-accent-amber.uppercase.tracking-widest',
            {},
            ['faded'],
          )
        : null,
    ]
  );
}

function variantStatsView(game, board) {
  if (game.game_type === 'ttt_fade') {
    const x = (game.state?.x_moves ?? []).length;
    const o = (game.state?.o_moves ?? []).length;
    return h('div.flex.items-center.justify-center.gap-6.text-xs', {}, [
      h('div.flex.items-center.gap-2', {}, [
        h('span.w-2.h-2.rounded-full', { style: { background: '#ff2bd6' } }, []),
        h('span.text-muted', {}, [`X pieces: ${x}/3`]),
      ]),
      h('div.flex.items-center.gap-2', {}, [
        h('span.w-2.h-2.rounded-full', { style: { background: '#22e1ff' } }, []),
        h('span.text-muted', {}, [`O pieces: ${o}/3`]),
      ]),
      game.state?.faded != null
        ? h('span.text-accent-amber', {}, [`Last faded: cell ${game.state.faded + 1}`])
        : null,
    ]);
  }
  if (game.game_type === 'ttt_chaos') {
    const locked = game.state?.locked;
    return h('div.flex.items-center.justify-center.gap-3.text-xs.text-muted', {}, [
      locked == null
        ? h('span', {}, ['No cell locked · anything goes this turn'])
        : h('span.text-accent-rose', {}, [`Cell ${locked + 1} locked this turn`]),
    ]);
  }
  return null;
}

// ----------------------------------------------------------------------------
// Chaos per-turn event banner
// ----------------------------------------------------------------------------
function chaosEventBanner(game, mySeat) {
  const ev = game.state?.event;
  if (!ev || !ev.type || ev.type === 'nothing') return null;

  const xName = game.x?.display_name ?? 'X';
  const oName = game.o?.display_name ?? 'O';
  const turnName = game.turn === 0 ? xName : oName;
  const oppName  = game.turn === 0 ? oName : xName;
  const isMyTurn = mySeat === game.turn;

  let icon = '⚡'; let title = 'Chaos event'; let detail = ''; let tone = '#22e1ff';
  switch (ev.type) {
    case 'block':
      icon = '🔒'; title = 'Cell locked';
      detail = `Cell ${ev.cell + 1} is locked for ${isMyTurn ? 'you' : turnName} this turn.`;
      tone = '#ff2bd6';
      break;
    case 'remove_own':
      icon = '💥'; title = 'Piece removed';
      detail = `${isMyTurn ? 'One of your own pieces' : turnName + "'s own piece"} (cell ${ev.cell + 1}) vanished.`;
      tone = '#ff6d8a';
      break;
    case 'remove_opp':
      icon = '🎯'; title = 'Opponent piece removed';
      detail = `${isMyTurn ? 'An opponent piece' : oppName + "'s piece"} (cell ${ev.cell + 1}) was wiped from the board.`;
      tone = '#3ddc7e';
      break;
    case 'swap':
      icon = '🔀'; title = 'Swap';
      detail = `Cells ${ev.own + 1} and ${ev.opp + 1} swapped owners.`;
      tone = '#b06bff';
      break;
    default:
      return null;
  }

  return h('div.glass.p-3.rounded-xl.flex.items-center.gap-3', {
    style: {
      border: `1px solid ${tone}55`,
      boxShadow: `0 0 16px ${tone}33`,
      background: `linear-gradient(90deg, ${tone}11, transparent)`,
    },
  }, [
    h('span.text-2xl', {}, [icon]),
    h('div.flex.flex-col.min-w-0.flex-1', {}, [
      h('span.text-xs.uppercase.tracking-widest', { style: { color: tone } }, [title]),
      h('span.text-sm.text-white', {}, [detail]),
    ]),
    h('span.text-[10px].text-muted.uppercase.tracking-widest', {}, [
      isMyTurn ? 'Your turn' : `${turnName}'s turn`,
    ]),
  ]);
}
