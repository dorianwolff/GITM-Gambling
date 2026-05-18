/**
 * mp-warfront-page.js
 * Warfront PvP: two players each draft a team from the current rotation,
 * commit simultaneously, then a server-scored battle plays out.
 *
 * Two route handlers exported:
 *   renderMpWarfrontLobby(ctx)  →  /games/warfront-pvp        (room browser)
 *   renderMpWarfront(ctx)       →  /games/warfront-pvp/:id    (live game)
 */
import { h, mount } from '../../utils/dom.js';
import { appShell } from '../../ui/layout/app-shell.js';
import { userStore, patchProfile } from '../../state/user-store.js';
import { toastError, toastSuccess } from '../../ui/components/toast.js';
import { formatCredits, shortName } from '../../utils/format.js';
import { logger } from '../../lib/logger.js';
import {
  injectWarfrontStylesOnce,
  renderWarfrontUnitGrid,
  renderWarfrontBattleStage,
} from '../../games/warfront/warfront-ui.js';
import {
  getWarfrontUnits,
  getActiveDraftUnits,
  getUnitById,
} from '../../games/warfront/warfront-api.js';
import {
  WF_PVP_ANTE_CHOICES,
  WF_PVP_DRAFT_BUDGET,
  pvpCreate,
  pvpJoin,
  pvpCommit,
  pvpCancel,
  getPvpGame,
  subscribeToPvpGame,
  subscribeToPvpLobby,
  pvpOpenRooms,
} from '../../games/warfront/warfront-pvp-api.js';
import { refreshProfile } from '../../services/profile-service.js';

// ─────────────────────────────────────────────────────────────────────────────
//  LOBBY  (/games/warfront-pvp)
// ─────────────────────────────────────────────────────────────────────────────

export function renderMpWarfrontLobby(ctx) {
  injectWarfrontStylesOnce();

  let rooms = [];
  let loading = true;
  let creating = false;
  let selectedAnte = 25;

  const root = h('div.flex.flex-col.gap-4', {}, []);
  const redraw = () => mount(root, lobbyView());

  async function loadRooms() {
    try {
      rooms = await pvpOpenRooms();
    } catch (e) {
      logger.warn('wf-pvp lobby load failed', e);
    } finally {
      loading = false;
      redraw();
    }
  }

  async function handleCreate() {
    creating = true; redraw();
    try {
      const game = await pvpCreate(selectedAnte);
      ctx.navigate(`/games/warfront-pvp/${game.id}`);
    } catch (e) {
      toastError(e.message);
      creating = false; redraw();
    }
  }

  async function handleJoin(roomId) {
    try {
      await pvpJoin(roomId);
      ctx.navigate(`/games/warfront-pvp/${roomId}`);
    } catch (e) {
      toastError(e.message);
      loadRooms();
    }
  }

  loadRooms();
  const off = subscribeToPvpLobby(() => loadRooms());
  ctx.onCleanup(off);
  const unsubProfile = userStore.subscribe(() => redraw());
  ctx.onCleanup(unsubProfile);

  function lobbyView() {
    const me = userStore.get().user;
    const credits = userStore.get().profile?.credits ?? 0;

    return h('div.flex.flex-col.gap-6.p-4', {}, [
      // Header
      h('div.flex.items-center.justify-between', {}, [
        h('div', {}, [
          h('h1.text-3xl.font-semibold.heading-grad', {}, ['⚔ Warfront PvP']),
          h('p.text-sm.text-muted.mt-1', {}, [
            'Draft a team from the rotation and face another player. Winner takes the pot.',
          ]),
        ]),
        h('button.btn-ghost.h-9.px-3.text-xs', { onclick: () => ctx.navigate('/games/warfront') },
          ['← Solo Mode']),
      ]),

      // Create a room
      h('div.glass.neon-border.p-5.flex.flex-col.gap-4', {}, [
        h('span.text-xs.uppercase.tracking-widest.text-muted', {}, ['Create a room']),
        h('div.flex.flex-wrap.gap-2', {},
          WF_PVP_ANTE_CHOICES.map((v) =>
            h('button', {
              class: `px-3 h-8 rounded-lg text-sm font-mono font-bold transition-colors ${
                selectedAnte === v
                  ? 'bg-accent-cyan text-black'
                  : 'bg-white/5 text-white hover:bg-white/10'
              }`,
              onclick: () => { selectedAnte = v; redraw(); },
            }, [`${formatCredits(v)} cr`])
          )
        ),
        h('div.flex.items-center.gap-3.flex-wrap', {}, [
          h('span.text-xs.text-muted', {}, [`Pot: ${formatCredits(selectedAnte * 2)} cr · Balance: ${formatCredits(credits)} cr`]),
          h('button.btn-main.h-9.px-5', {
            onclick: handleCreate,
            disabled: creating || credits < selectedAnte,
          }, [creating ? 'Creating…' : '⚔ Create Room']),
        ]),
      ]),

      // Open rooms
      h('div.flex.flex-col.gap-3', {}, [
        h('span.text-xs.uppercase.tracking-widest.text-muted', {}, ['Open rooms']),
        loading
          ? h('p.text-muted.text-sm', {}, ['Loading…'])
          : rooms.length === 0
            ? h('p.text-muted.text-sm', {}, ['No open rooms yet — be the first!'])
            : h('div.flex.flex-col.gap-2', {},
                rooms.map((r) => roomCard(r, me, credits, handleJoin))
              ),
      ]),
    ]);
  }

  redraw();
  return appShell(root);
}

function roomCard(r, me, credits, onJoin) {
  const canAfford = credits >= r.ante;
  return h('div.glass.neon-border.p-4.flex.items-center.justify-between.gap-3.flex-wrap', {}, [
    h('div.flex.flex-col.gap-0.5', {}, [
      h('span.text-sm.font-semibold', {}, [shortName(r.x_name, '') || 'Player']),
      h('span.text-xs.text-muted', {}, [
        `Ante: ${formatCredits(r.ante)} cr · Pot: ${formatCredits(r.ante * 2)} cr`,
      ]),
    ]),
    h('button.btn-main.h-9.px-4.text-sm', {
      onclick: () => onJoin(r.id),
      disabled: !canAfford,
    }, [canAfford ? 'Join' : 'Not enough credits']),
  ]);
}


// ─────────────────────────────────────────────────────────────────────────────
//  GAME  (/games/warfront-pvp/:id)
// ─────────────────────────────────────────────────────────────────────────────

const PHASES = Object.freeze({
  LOADING:    'loading',
  WAITING:    'waiting',    // in room, opponent not joined yet
  DRAFT:      'draft',      // both in room, drafting
  COMMITTED:  'committed',  // I've committed, waiting for opponent
  BATTLE:     'battle',     // both committed → animate
  RESULT:     'result',     // animation done
});

export function renderMpWarfront(ctx) {
  injectWarfrontStylesOnce();

  const gameId = ctx.params.id;

  let phase = PHASES.LOADING;
  let game = null;
  let mySeat = null;          // 0 = X, 1 = O
  let myCollection = 'fantasy';
  let qty = {};               // id → count
  let battleCleanup = null;
  let hudPortal = null;
  let hudInnerEl = null;

  const root = h('div.flex.flex-col.gap-4', {}, []);
  const redraw = () => mount(root, view());

  // ── helpers ────────────────────────────────────────────────────────────────

  function resetQty(collection = myCollection) {
    qty = Object.fromEntries(getWarfrontUnits(collection).map((u) => [u.id, 0]));
  }
  resetQty();

  function calcSpent() {
    return getWarfrontUnits(myCollection).reduce((s, u) => s + (qty[u.id] || 0) * u.cost, 0);
  }
  function calcSlots() {
    return getWarfrontUnits(myCollection).reduce((s, u) => s + (qty[u.id] || 0), 0);
  }
  function getDraftArmy() {
    return getWarfrontUnits(myCollection).flatMap((u) =>
      Array.from({ length: qty[u.id] || 0 }, () => u.id)
    );
  }

  function syncHud(spent, slots) {
    if (phase !== PHASES.DRAFT && phase !== PHASES.COMMITTED) {
      if (hudPortal) hudPortal.style.display = 'none';
      return;
    }
    if (!hudPortal) {
      hudPortal = document.createElement('div');
      hudPortal.style.cssText = 'position:fixed;top:64px;left:0;right:0;z-index:50;padding:0 16px';
      hudInnerEl = document.createElement('div');
      hudInnerEl.style.cssText = 'max-width:1400px;margin:0 auto;display:flex;justify-content:center';
      hudPortal.appendChild(hudInnerEl);
      document.body.appendChild(hudPortal);
    }
    const s = spent ?? calcSpent();
    const sl = slots ?? calcSlots();
    mount(hudInnerEl, h('div.wf-hud', {}, [
      h('div.wf-hud-stat', {}, [
        h('span.wf-hud-icon', {}, ['◈']),
        h('div.wf-hud-body', {}, [
          h('span.wf-hud-val.gold', {}, [`${WF_PVP_DRAFT_BUDGET - s}g`]),
          h('span.wf-hud-lbl', {}, ['gold left']),
        ]),
      ]),
      h('div.wf-hud-stat', {}, [
        h('span.wf-hud-icon', {}, ['▣']),
        h('div.wf-hud-body', {}, [
          h('span.wf-hud-val.cyan', {}, [`${sl}/6`]),
          h('span.wf-hud-lbl', {}, ['slots']),
        ]),
      ]),
    ]));
    hudPortal.style.display = 'block';
  }

  ctx.onCleanup(() => {
    if (battleCleanup) battleCleanup();
    if (hudPortal) { hudPortal.remove(); hudPortal = null; hudInnerEl = null; }
  });

  // ── load / realtime ────────────────────────────────────────────────────────

  async function load() {
    try {
      const prev = game;
      game = await getPvpGame(gameId);

      // Determine our seat (only once).
      if (mySeat === null) {
        const me = userStore.get().user?.id;
        if (game.player_x === me) mySeat = 0;
        else if (game.player_o === me) mySeat = 1;
      }

      // Detect status transitions.
      const wasWaiting = prev?.status === 'waiting';
      const nowDrafting = game?.status === 'drafting';
      const nowFinished = game?.status === 'finished';

      if (nowFinished && phase !== PHASES.RESULT && phase !== PHASES.BATTLE) {
        // Both committed → start battle animation.
        setPhase(PHASES.BATTLE);
      } else if (nowDrafting && wasWaiting) {
        setPhase(PHASES.DRAFT);
      } else if (phase === PHASES.LOADING) {
        setPhase(statusToPhase(game));
      } else {
        redraw();
      }

      // Trigger profile refresh after the game settles so balance updates.
      if (nowFinished) {
        const me = userStore.get().user;
        if (me) {
          refreshProfile(me.id)
            .then((p) => patchProfile(p))
            .catch((e) => logger.warn('profile refresh after wf-pvp failed', e));
        }
      }
    } catch (e) {
      logger.warn('wf-pvp load failed', e);
      toastError(e.message);
    }
  }

  function statusToPhase(g) {
    if (!g) return PHASES.LOADING;
    if (g.status === 'finished') return PHASES.BATTLE;
    if (g.status === 'drafting') {
      const myReady = mySeat === 0 ? g.x_ready : g.o_ready;
      return myReady ? PHASES.COMMITTED : PHASES.DRAFT;
    }
    if (g.status === 'waiting') return PHASES.WAITING;
    return PHASES.LOADING;
  }

  function setPhase(p) {
    if (p !== PHASES.BATTLE && battleCleanup) {
      battleCleanup(); battleCleanup = null;
    }
    phase = p;
    redraw();
  }

  load();
  const off = subscribeToPvpGame(gameId, () => load());
  ctx.onCleanup(off);
  const unsubProfile = userStore.subscribe(() => redraw());
  ctx.onCleanup(unsubProfile);

  // ── actions ────────────────────────────────────────────────────────────────

  async function handleCancel() {
    try {
      await pvpCancel(gameId);
      ctx.navigate('/games/warfront-pvp');
    } catch (e) {
      toastError(e.message);
    }
  }

  function changeQty(id, delta) {
    const u = getWarfrontUnits(myCollection).find((x) => x.id === id);
    if (!u) return;
    const cur = qty[id] || 0, next = cur + delta;
    if (next < 0) return;
    const nextSpent = calcSpent() - cur * u.cost + next * u.cost;
    const nextSlots = calcSlots() - cur + next;
    if (nextSpent > WF_PVP_DRAFT_BUDGET) { toastError('Not enough draft gold'); return; }
    if (nextSlots > 6) { toastError('Max 6 unit slots'); return; }
    qty[id] = next;
    syncHud();
    redraw();
  }

  function selectCollection(col) {
    if (myCollection === col) return;
    myCollection = col;
    resetQty(col);
    redraw();
  }

  async function handleCommit() {
    const army = getDraftArmy();
    if (army.length === 0) { toastError('Pick at least one unit'); return; }
    setPhase(PHASES.COMMITTED);
    try {
      const updated = await pvpCommit(gameId, army, myCollection);
      game = updated;
      // If server already resolved (we were 2nd to commit):
      if (updated.status === 'finished') {
        setPhase(PHASES.BATTLE);
      }
      // Otherwise stay COMMITTED until realtime fires.
    } catch (e) {
      toastError(e.message);
      setPhase(PHASES.DRAFT);
    }
  }

  function handleBattleEnd() {
    setPhase(PHASES.RESULT);
  }

  // ── view ───────────────────────────────────────────────────────────────────

  function view() {
    if (phase === PHASES.LOADING || !game) {
      return appShell(h('div.flex.items-center.justify-center.py-20', {}, [
        h('span.text-muted.text-sm', {}, ['Loading…']),
      ]));
    }

    const me = userStore.get().user;
    const opponent = mySeat === 0 ? game.o : game.x;
    const opponentName = shortName(opponent?.display_name, opponent?.email) || 'Opponent';
    const pot = formatCredits((game.ante ?? 0) * 2);

    // ── WAITING ──────────────────────────────────────────────────────────────
    if (phase === PHASES.WAITING) {
      return appShell(h('div.flex.flex-col.gap-6.p-4', {}, [
        lobbyHeader(ctx),
        h('div.glass.neon-border.p-8.flex.flex-col.items-center.gap-4', {}, [
          h('span.text-4xl', {}, ['⚔']),
          h('h2.text-xl.font-bold.text-white', {}, ['Waiting for an opponent…']),
          h('p.text-sm.text-muted', {}, [`Ante: ${formatCredits(game.ante)} cr · Pot: ${pot} cr`]),
          h('div.flex.items-center.gap-2.mt-2', {}, [
            h('div.w-2.h-2.rounded-full.bg-accent-cyan.animate-pulse', {}, []),
            h('span.text-xs.text-muted', {}, ['Share this page URL to invite a friend']),
          ]),
          mySeat === 0
            ? h('button.btn-ghost.h-9.px-4.text-sm.text-rose-400', { onclick: handleCancel },
                ['✕ Cancel Room'])
            : null,
        ]),
      ]));
    }

    // ── DRAFT / COMMITTED ────────────────────────────────────────────────────
    if (phase === PHASES.DRAFT || phase === PHASES.COMMITTED) {
      const spent = calcSpent();
      const slots = calcSlots();
      syncHud(spent, slots);
      const committed = phase === PHASES.COMMITTED;

      return appShell(h('div.flex.flex-col.gap-4.p-4', {}, [
        h('div.wf-hud-spacer', {}, []),

        // Header row
        h('div.flex.items-center.justify-between', {}, [
          h('div', {}, [
            h('h2.text-2xl.font-bold.text-white', {}, ['⚔ Warfront PvP']),
            h('p.text-xs.text-muted.mt-0.5', {}, [
              `vs ${opponentName} · Pot: ${pot} cr`,
            ]),
          ]),
          pvpStatusPill(game, mySeat),
        ]),

        // Collection tabs
        h('div.grid.grid-cols-2.gap-2', {}, [
          h('button.wf-col-btn', {
            class: myCollection === 'fantasy' ? 'wf-col-btn active fantasy' : 'wf-col-btn fantasy',
            onClick: () => !committed && selectCollection('fantasy'),
            disabled: committed,
          }, ['⚔ Fantasy']),
          h('button.wf-col-btn', {
            class: myCollection === 'animals' ? 'wf-col-btn active animals' : 'wf-col-btn animals',
            onClick: () => !committed && selectCollection('animals'),
            disabled: committed,
          }, ['🐾 Animals']),
        ]),

        h('p.text-xs.text-white/40.text-center', {}, [
          '12 units in rotation · draft budget: 10g · max 6 slots',
        ]),

        // Unit grid
        renderWarfrontUnitGrid({
          qty,
          budget: WF_PVP_DRAFT_BUDGET,
          units: getActiveDraftUnits(myCollection),
          maxSlots: 6,
          onQtyChange: committed ? () => {} : changeQty,
        }),

        // Army strip + action button
        h('div.army-sticky', {}, [
          h('div.roster', {},
            getDraftArmy().length
              ? getDraftArmy().map((id) =>
                  h('span.roster-chip', {}, [getUnitById(id)?.icon || '•'])
                )
              : [h('span.roster-empty', {}, ['No units selected yet'])]
          ),
          committed
            ? h('div.flex.flex-col.items-center.gap-2', {}, [
                h('div.flex.items-center.gap-2', {}, [
                  h('div.w-2.h-2.rounded-full.bg-accent-cyan.animate-pulse', {}, []),
                  h('span.text-sm.text-accent-cyan', {}, ['Army committed — waiting for opponent…']),
                ]),
              ])
            : h('button.btn-main', {
                onClick: handleCommit,
                disabled: slots === 0,
              }, ['⚔ Lock In Army']),
        ]),
      ]), { wide: true });
    }

    // ── BATTLE ───────────────────────────────────────────────────────────────
    if (phase === PHASES.BATTLE) {
      syncHud();

      const myPicks   = mySeat === 0 ? (game.x_picks ?? []) : (game.o_picks ?? []);
      const oppPicks  = mySeat === 0 ? (game.o_picks ?? []) : (game.x_picks ?? []);
      const myCol     = mySeat === 0 ? game.x_collection : game.o_collection;

      // Adapt result shape expected by renderWarfrontBattleStage.
      const battleResult = {
        enemyArmy:        oppPicks,
        enemyDifficulty:  'PvP',
        enemyBudget:      WF_PVP_DRAFT_BUDGET,
      };

      const container = h('div.flex.flex-col.gap-4.p-4', {}, [
        h('div.flex.items-center.justify-between', {}, [
          h('h2', {
            style: { fontFamily: "'Cinzel',serif", fontSize: '20px', fontWeight: '700',
                     color: '#c0b0f0', letterSpacing: '2px' },
          }, ['⚔ Warfront PvP']),
          h('p.text-xs.text-muted', {}, [`vs ${opponentName} · Pot: ${pot} cr`]),
        ]),
        (() => {
          const el = renderWarfrontBattleStage({
            picks:       myPicks,
            result:      battleResult,
            getUnitById: (id) => getUnitById(id),
            onComplete:  handleBattleEnd,
            onSurrender: handleBattleEnd,
          });
          battleCleanup = el._cleanup ?? null;
          return el;
        })(),
      ]);

      return appShell(container, { wide: true });
    }

    // ── RESULT ───────────────────────────────────────────────────────────────
    if (phase === PHASES.RESULT) {
      syncHud();

      // Determine from server result (NOT from animation HP).
      const iWon = game.winner === mySeat;
      const isDraw = game.winner === -1;
      const myHp  = mySeat === 0 ? (game.x_base_hp ?? 0) : (game.o_base_hp ?? 0);
      const oppHp = mySeat === 0 ? (game.o_base_hp ?? 0) : (game.x_base_hp ?? 0);
      const payout = iWon ? (game.ante ?? 0) * 2 : 0;

      const cardClass = isDraw ? 'loss' : iWon ? 'win' : 'loss';
      const emoji     = isDraw ? '🤝' : iWon ? '🏆' : '💀';
      const label     = isDraw ? 'Draw'    : iWon ? 'Victory' : 'Defeat';
      const subLabel  = isDraw ? 'Ante refunded' : iWon ? `${opponentName}'s base destroyed` : 'Your base has fallen';

      return appShell(h('div.flex.flex-col.gap-4.p-4', {}, [
        h('div.flex.items-center.justify-between', {}, [
          h('h2', {
            style: { fontFamily: "'Cinzel',serif", fontSize: '20px', fontWeight: '700',
                     color: '#c0b0f0', letterSpacing: '2px' },
          }, ['⚔ Warfront PvP']),
          h('button.btn-ghost.h-9.px-3.text-xs', { onclick: () => ctx.navigate('/games/warfront-pvp') },
            ['← Lobby']),
        ]),

        // Result card
        h('div', { class: `wf-result ${cardClass}` }, [
          h('div.wf-result-scan', {}, []),
          h('span.wf-result-emoji', {}, [emoji]),
          h('span.wf-result-title', {}, [label]),
          h('p.wf-result-sub', {}, [subLabel]),

          // PvP badge instead of difficulty chip
          h('span', {
            class: 'wf-diff-chip',
            style: { background: 'rgba(176,107,255,0.2)', border: '1px solid rgba(176,107,255,0.6)',
                     color: '#c87dff' },
          }, ['PvP']),

          // HP scoreboard
          h('div.wf-scoreboard', {}, [
            h('div.wf-score-box.player', {}, [
              h('span.wf-score-val', {}, [String(myHp)]),
              h('span.wf-score-lbl', {}, ['Your Base']),
            ]),
            h('div.wf-score-vs', {}, ['vs']),
            h('div.wf-score-box.enemy', {}, [
              h('span.wf-score-val', {}, [String(oppHp)]),
              h('span.wf-score-lbl', {}, [`${opponentName}'s Base`]),
            ]),
          ]),

          // Payout banner (win only)
          iWon
            ? h('div.wf-payout-banner', {}, [
                h('span.wf-payout-amount', {}, [`+${formatCredits(payout)} cr`]),
                h('span.wf-payout-mult', {}, ['Winner takes all · PvP']),
              ])
            : null,
        ]),

        // Actions
        h('div.wf-result-btns', {}, [
          h('button.wf-btn-ghost', { onclick: () => ctx.navigate('/games/warfront-pvp') },
            ['New Game']),
          h('button.wf-btn-accent', { onclick: () => ctx.navigate('/games/warfront') },
            ['Solo Mode']),
        ]),
      ]), { wide: true });
    }

    return appShell(h('div.p-4', {}, ['Unknown phase']));
  }

  redraw();
  return root;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

function lobbyHeader(ctx) {
  return h('div.flex.items-center.justify-between', {}, [
    h('h1.text-2xl.font-bold.text-white', {}, ['⚔ Warfront PvP']),
    h('button.btn-ghost.h-9.px-3.text-xs', { onclick: () => ctx.navigate('/games/warfront') },
      ['← Solo Mode']),
  ]);
}

/** Small pill showing both players' ready state. */
function pvpStatusPill(game, mySeat) {
  const xDone = game.x_ready;
  const oDone = game.o_ready;
  const myDone = mySeat === 0 ? xDone : oDone;

  return h('div.flex.items-center.gap-2.text-xs.text-muted', {}, [
    h('span', { style: { color: xDone ? '#3ddc7e' : 'rgba(255,255,255,0.3)' } }, ['X']),
    h('span', {}, ['vs']),
    h('span', { style: { color: oDone ? '#3ddc7e' : 'rgba(255,255,255,0.3)' } }, ['O']),
    h('span.text-[10px].uppercase.tracking-wider', {
      style: { color: myDone ? '#3ddc7e' : '#22e1ff' },
    }, [myDone ? '✓ Locked' : 'Drafting']),
  ]);
}
