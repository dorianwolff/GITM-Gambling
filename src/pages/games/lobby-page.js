/**
 * lobby-page.js
 * Multiplayer lobby. Lists open (waiting) games, lets users create a new
 * one, shows the games they're already in with a resume button.
 *
 * Realtime: subscribes to mp_games INSERT/UPDATE/DELETE and refetches the
 * two lists when anything changes.
 */
import { h, mount } from '../../utils/dom.js';
import { appShell } from '../../ui/layout/app-shell.js';
import {
  listWaiting,
  listMine,
  createGame,
  joinGame,
  cancelGame,
  subscribeToLobby,
  MP_VARIANTS,
  ANTE_CHOICES,
  variantById,
} from '../../games/multiplayer/mp-api.js';
import { userStore } from '../../state/user-store.js';
import { toastError, toastSuccess } from '../../ui/components/toast.js';
import { formatCredits } from '../../utils/format.js';
import { logger } from '../../lib/logger.js';

export function renderLobby(ctx) {
  let waiting = [];
  let mine = [];
  let loading = true;
  let creating = false;
  let selectedVariant = MP_VARIANTS[0].id;
  let selectedAnte = 25;

  const root = h('div.flex.flex-col.gap-4', {}, []);
  const redraw = () => mount(root, view());

  async function reload() {
    const me = userStore.get().user;
    if (!me) return;
    try {
      const [w, m] = await Promise.all([listWaiting(), listMine(me.id)]);
      waiting = w ?? [];
      mine = m ?? [];
      loading = false;
      redraw();
    } catch (e) {
      logger.warn('lobby reload failed', e);
    }
  }

  reload();
  const off = subscribeToLobby(() => reload());
  ctx.onCleanup(off);

  async function handleCreate() {
    if (creating) return;
    creating = true;
    redraw();
    try {
      const id = await createGame(selectedVariant, selectedAnte);
      toastSuccess('Game created — waiting for opponent');
      ctx.navigate(`/games/mp/${id}`);
    } catch (e) {
      toastError(e.message);
    } finally {
      creating = false;
      redraw();
    }
  }

  async function handleJoin(id) {
    try {
      await joinGame(id);
      ctx.navigate(`/games/mp/${id}`);
    } catch (e) {
      toastError(e.message);
    }
  }

  async function handleCancel(id) {
    try {
      await cancelGame(id);
      toastSuccess('Game cancelled — ante refunded');
      reload();
    } catch (e) {
      toastError(e.message);
    }
  }

  // ---------- view ----------
  function view() {
    const me = userStore.get().user;
    return h('div.flex.flex-col.gap-4', {}, [
      // Header
      h('div.flex.items-end.justify-between.gap-3.flex-wrap', {}, [
        h('div', {}, [
          h('h1.text-3xl.font-semibold.heading-grad', {}, ['Multiplayer lobby']),
          h('p.text-sm.text-muted', {}, [
            'Pick a variant, set an ante, and wait for someone to join. Winner takes all!',
          ]),
        ]),
      ]),

      // Create game panel
      h('div.glass.neon-border.p-5.flex.flex-col.gap-4', {}, [
        h('h2.text-sm.text-muted.uppercase.tracking-widest', {}, ['Create a game']),
        h(
          'div.grid.grid-cols-1.md:grid-cols-2.gap-3',
          {},
          MP_VARIANTS.map((v) => variantCard(v, selectedVariant === v.id, () => {
            selectedVariant = v.id; redraw();
          }))
        ),
        h('div.flex.items-center.justify-between.gap-3.flex-wrap.pt-2', {}, [
          h('div.flex.flex-col.gap-1', {}, [
            h('span.text-[10px].text-muted.uppercase.tracking-widest', {}, ['Ante (each side)']),
            h(
              'div.flex.gap-1',
              {},
              ANTE_CHOICES.map((v) =>
                h(
                  `button.px-3.h-10.rounded-lg.text-sm.font-mono.font-bold.transition-colors`,
                  {
                    onclick: () => { selectedAnte = v; redraw(); },
                    style: {
                      background: selectedAnte === v ? 'rgba(34,225,255,0.15)' : 'rgba(255,255,255,0.03)',
                      border: selectedAnte === v ? '1px solid #22e1ff' : '1px solid rgba(255,255,255,0.08)',
                      color: selectedAnte === v ? '#22e1ff' : '#fff',
                    },
                  },
                  [String(v)]
                )
              )
            ),
          ]),
          h('div.flex.flex-col.gap-1.items-end', {}, [
            h('span.text-[10px].text-muted.uppercase.tracking-widest', {}, ['Pot (winner takes all)']),
            h('span.text-lg.font-mono.font-bold.text-accent-lime', {}, [
              `${formatCredits(selectedAnte * 2)} cr`,
            ]),
          ]),
          h(
            'button.btn-primary.h-11.px-6',
            { onclick: handleCreate, disabled: creating },
            [creating ? 'Creating…' : `Open ${variantById(selectedVariant).name} · ${selectedAnte} cr`]
          ),
        ]),
      ]),

      // Active/waiting games I'm already in
      mine.length > 0
        ? h('div.flex.flex-col.gap-2', {}, [
            h('h2.text-sm.text-muted.uppercase.tracking-widest', {}, ['Your games']),
            h(
              'div.grid.grid-cols-1.md:grid-cols-2.gap-3',
              {},
              mine.map((g) => myGameCard(g, me.id, ctx.navigate, handleCancel))
            ),
          ])
        : null,

      // Open games to join
      h('div.flex.flex-col.gap-2', {}, [
        h('h2.text-sm.text-muted.uppercase.tracking-widest', {}, [
          `Open games${waiting.length ? ` · ${waiting.length}` : ''}`,
        ]),
        loading
          ? h('div.text-sm.text-muted.py-6.text-center', {}, ['Loading…'])
          : waiting.length === 0
            ? h('div.glass.p-6.text-center.text-sm.text-muted', {}, [
                'No open games right now. Start one above — someone will join shortly.',
              ])
            : h(
                'div.grid.grid-cols-1.md:grid-cols-2.gap-3',
                {},
                waiting
                  .filter((g) => g.player_x !== me?.id) // hide my own from "join" list
                  .map((g) => openGameCard(g, () => handleJoin(g.id)))
              ),
      ]),
    ]);
  }

  redraw();
  return appShell(root);
}

// ----------------------------------------------------------------------------
// Pieces
// ----------------------------------------------------------------------------

function variantCard(v, selected, onClick) {
  return h(
    'button.relative.glass.p-4.flex.flex-col.gap-2.text-left.transition-transform.hover:-translate-y-0.5',
    {
      onclick: onClick,
      style: {
        border: selected ? '2px solid #22e1ff' : '1px solid rgba(255,255,255,0.08)',
        boxShadow: selected ? '0 0 14px rgba(34,225,255,0.3)' : 'none',
      },
    },
    [
      h(`div.absolute.inset-0.opacity-40.bg-gradient-to-br.${v.grad}.rounded-[inherit].pointer-events-none`, {}, []),
      h('div.relative.flex.items-center.gap-3', {}, [
        h('span.text-3xl', {}, [v.icon]),
        h('div.flex.flex-col.leading-tight', {}, [
          h('span.text-lg.font-semibold', {}, [v.name]),
          h('span.text-xs.text-white/75', {}, [v.blurb]),
        ]),
      ]),
    ]
  );
}

function openGameCard(g, onJoin) {
  const v = variantById(g.game_type);
  const creator = g.x?.display_name ?? 'Anon';
  return h('div.glass.neon-border.p-4.flex.items-center.justify-between.gap-3', {}, [
    h('div.flex.items-center.gap-3.min-w-0', {}, [
      h('span.text-2xl', {}, [v.icon]),
      h('div.flex.flex-col.leading-tight.min-w-0', {}, [
        h('span.text-sm.font-semibold.truncate', {}, [v.name]),
        h('span.text-xs.text-muted', {}, [`by ${creator}`]),
      ]),
    ]),
    h('div.flex.items-center.gap-3', {}, [
      h('div.flex.flex-col.items-end.leading-tight', {}, [
        h('span.text-[10px].text-muted.uppercase.tracking-widest', {}, ['Ante']),
        h('span.font-mono.text-accent-cyan', {}, [`${g.ante} cr`]),
      ]),
      h('button.btn-primary.h-9.px-4.text-xs', { onclick: onJoin }, ['Join →']),
    ]),
  ]);
}

function myGameCard(g, myId, navigate, onCancel) {
  const v = variantById(g.game_type);
  const isCreator = g.player_x === myId;
  const opp = isCreator ? g.o : g.x;
  const oppName = opp?.display_name ?? (g.status === 'waiting' ? 'Waiting for opponent…' : 'Unknown');

  return h('div.glass.neon-border.p-4.flex.items-center.justify-between.gap-3', {}, [
    h('div.flex.items-center.gap-3.min-w-0', {}, [
      h('span.text-2xl', {}, [v.icon]),
      h('div.flex.flex-col.leading-tight.min-w-0', {}, [
        h('div.flex.items-center.gap-2', {}, [
          h('span.text-sm.font-semibold', {}, [v.name]),
          g.status === 'waiting'
            ? h(
                'span.chip.bg-accent-amber/10.border-accent-amber/40.text-accent-amber.text-[10px]',
                {},
                ['WAITING']
              )
            : h(
                'span.chip.bg-accent-lime/10.border-accent-lime/40.text-accent-lime.text-[10px]',
                {},
                ['ACTIVE']
              ),
        ]),
        h('span.text-xs.text-muted.truncate', {}, [`vs ${oppName}`]),
      ]),
    ]),
    h('div.flex.items-center.gap-2', {}, [
      h('span.font-mono.text-xs.text-muted', {}, [`${g.ante} cr`]),
      g.status === 'waiting' && isCreator
        ? h(
            'button.btn-ghost.h-9.px-3.text-xs',
            { onclick: () => onCancel(g.id) },
            ['Cancel']
          )
        : null,
      h(
        'button.btn-primary.h-9.px-3.text-xs',
        { onclick: () => navigate(`/games/mp/${g.id}`) },
        [g.status === 'waiting' ? 'View' : 'Resume →']
      ),
    ]),
  ]);
}
