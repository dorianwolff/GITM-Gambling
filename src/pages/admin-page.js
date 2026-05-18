/**
 * admin-page.js
 * Admin control panel for credit grants, bans, collectible grants and full resets.
 */
import { h, mount } from '../utils/dom.js';
import { appShell } from '../ui/layout/app-shell.js';
import { ECONOMY, ROUTES } from '../config/constants.js';
import { formatCredits, initials, shortName } from '../utils/format.js';
import { spinner } from '../ui/components/spinner.js';
import { toastError, toastSuccess, toastWarn } from '../ui/components/toast.js';
import {
  fetchAdminUsers,
  fetchAdminCollectibles,
  adminGrantCredits,
  adminSetBan,
  adminGrantCollectible,
  adminResetAllProgress,
  adminGetRotation,
  adminAdvanceRotation,
  adminResetRotationOffset,
} from '../services/admin-service.js';

const GAME_DISPLAY_NAMES = {
  blackjack: 'Blackjack', candy: 'Candy Crush', cases: 'Cases',
  coinflip: 'Coin Flip', crash: 'Crash', dice: 'Dice',
  gacha: 'Gacha', mines: 'Miner', plinko: 'Plinko',
  roulette: 'Roulette', warfront: 'Warfront', pinball: 'Pinball',
  lottery: 'Lottery',
};

const COLLECTIBLE_CATEGORIES = new Set(['effect', 'frame', 'title', 'badge', 'trophy']);

export function renderAdmin() {
  let users = [];
  let collectibles = [];
  let loading = true;
  let error = null;
  let userSearch = '';
  let selectedUserId = '';

  // Rotation state
  let rotation = { games: [], extraSlots: 0 };
  let rotationBusy = false;

  const root = h('div.max-w-7xl.mx-auto.w-full.flex.flex-col.gap-5', {}, []);
  const redraw = () => mount(root, view());

  loadData();

  async function loadData() {
    loading = true;
    error = null;
    redraw();
    try {
      const [nextUsers, nextCollectibles, nextRotation] = await Promise.all([
        fetchAdminUsers(),
        fetchAdminCollectibles(),
        adminGetRotation().catch(() => ({ games: [], extraSlots: 0 })),
      ]);
      users = nextUsers;
      collectibles = nextCollectibles.filter((item) => COLLECTIBLE_CATEGORIES.has(item.category));
      rotation = nextRotation;
      loading = false;
      if (!selectedUserId && users.length) {
        selectedUserId = (users.find((u) => !u.is_admin && !u.is_banned)
          ?? users.find((u) => !u.is_admin)
          ?? users[0]).id;
      }
      if (!selectedCollectibleId && collectibles[0]) {
        selectedCollectibleId = collectibles[0].id;
      }
      redraw();
    } catch (e) {
      loading = false;
      error = e?.message ?? String(e);
      redraw();
    }
  }

  async function doAdvanceRotation() {
    if (rotationBusy) return;
    rotationBusy = true; redraw();
    try {
      const games = await adminAdvanceRotation(1);
      rotation = { games, extraSlots: rotation.extraSlots + 1 };
      toastSuccess(`Rotation advanced by 1 slot (total offset: +${rotation.extraSlots})`);
    } catch (e) {
      toastError(e.message);
    } finally {
      rotationBusy = false; redraw();
    }
  }

  async function doResetRotationOffset() {
    if (rotationBusy) return;
    rotationBusy = true; redraw();
    try {
      const games = await adminResetRotationOffset();
      rotation = { games, extraSlots: 0 };
      toastSuccess('Rotation offset reset to wall-clock time');
    } catch (e) {
      toastError(e.message);
    } finally {
      rotationBusy = false; redraw();
    }
  }

  let selectedCollectibleId = '';
  let creditsAmountInput;
  let banReasonInput;
  let resetConfirmInput;
  let collectibleQtyInput;
  let collectibleNoteInput;
  let creditNoteInput;
  let userSearchInput;

  function getVisibleUsers() {
    const needle = userSearch.trim().toLowerCase();
    const ordered = [...users].sort((a, b) => {
      if ((a.is_banned ? 1 : 0) !== (b.is_banned ? 1 : 0)) return a.is_banned ? 1 : -1;
      const an = (a.display_name ?? a.email ?? '').toLowerCase();
      const bn = (b.display_name ?? b.email ?? '').toLowerCase();
      return an.localeCompare(bn);
    });
    if (!needle) return ordered;
    return ordered.filter((u) => {
      const hay = [u.display_name, u.email, u.id, u.ban_reason].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(needle);
    });
  }

  function getSelectableUsers() {
    return [...users].sort((a, b) => {
      const an = (a.display_name ?? a.email ?? '').toLowerCase();
      const bn = (b.display_name ?? b.email ?? '').toLowerCase();
      return an.localeCompare(bn);
    });
  }

  function activeUserCount() {
    return users.filter((u) => !u.is_banned).length;
  }

  function bannedUsers() {
    return users.filter((u) => u.is_banned);
  }

  async function doCreditGrant(target, { allUsers = false, zeroOnly = false } = {}) {
    const amount = Number.parseInt(creditsAmountInput?.value ?? '0', 10);
    const note = String(creditNoteInput?.value ?? '').trim();
    if (!Number.isFinite(amount) || amount < 1) {
      toastError('Enter a positive credit amount.');
      return;
    }
    if (!allUsers && !zeroOnly && !target) {
      toastWarn('Select a target user first.');
      return;
    }
    try {
      const count = await adminGrantCredits({
        amount,
        targetUserId: target,
        grantToAll: allUsers,
        zeroOnly,
        note,
      });
      toastSuccess(zeroOnly
        ? `Granted ${formatCredits(amount)} to ${count} zero-credit user${count === 1 ? '' : 's'}`
        : allUsers
          ? `Granted ${formatCredits(amount)} to ${count} user${count === 1 ? '' : 's'}`
          : `Granted ${formatCredits(amount)} to ${shortName(users.find((u) => u.id === target)?.display_name, users.find((u) => u.id === target)?.email)}`
      );
      await loadData();
    } catch (e) {
      toastError(e.message ?? String(e));
    }
  }

  async function doBan(user, banned) {
    const reason = String(banReasonInput?.value ?? '').trim();
    if (banned && !reason) {
      toastWarn('Add a ban reason before suspending a user.');
      return;
    }
    try {
      await adminSetBan({ userId: user.id, banned, reason });
      toastSuccess(banned ? `Suspended ${user.display_name ?? user.email ?? user.id}` : `Unbanned ${user.display_name ?? user.email ?? user.id}`);
      await loadData();
    } catch (e) {
      toastError(e.message ?? String(e));
    }
  }

  async function doGrantCollectible(target, { allUsers = false } = {}) {
    const itemId = selectedCollectibleId || collectibles[0]?.id;
    const qty = Number.parseInt(collectibleQtyInput?.value ?? selectedCollectibleQty ?? '1', 10);
    const note = String(collectibleNoteInput?.value ?? '').trim();
    const item = collectibles.find((x) => x.id === itemId);
    if (!item) {
      toastError('Pick a collectible first.');
      return;
    }
    if (!Number.isFinite(qty) || qty < 1) {
      toastError('Quantity must be at least 1.');
      return;
    }
    if (!allUsers && !target) {
      toastWarn('Select a target user first.');
      return;
    }
    if (item.is_unique && allUsers) {
      toastError('Unique collectibles can only be granted to one user.');
      return;
    }
    try {
      const count = await adminGrantCollectible({
        itemId,
        targetUserId: target,
        grantToAll: allUsers,
        quantity: qty,
        note,
      });
      toastSuccess(allUsers
        ? `Granted ${item.name} to ${count} user${count === 1 ? '' : 's'}`
        : `Granted ${item.name} to ${shortName(users.find((u) => u.id === target)?.display_name, users.find((u) => u.id === target)?.email)}`
      );
      await loadData();
    } catch (e) {
      toastError(e.message ?? String(e));
    }
  }

  async function doResetAll() {
    const typed = String(resetConfirmInput?.value ?? '').trim();
    if (typed !== 'RESET ALL') {
      toastWarn('Type RESET ALL to confirm the wipe.');
      return;
    }
    if (!window.confirm('This will wipe all user progress, histories, inventories, leaderboards and unique gacha claims. Continue?')) {
      return;
    }
    try {
      await adminResetAllProgress();
      toastSuccess('All user progress has been reset.');
      await loadData();
    } catch (e) {
      toastError(e.message ?? String(e));
    }
  }

  function view() {
    const visible = getVisibleUsers();
    const banned = bannedUsers();
    const zeroCreditCount = users.filter((u) => Number(u.credits ?? 0) === 0).length;
    const totalCollectibles = collectibles.length;

    if (loading) {
      return h('div.flex.items-center.justify-center.py-20.gap-3.text-muted', {}, [spinner(), 'Loading admin panel…']);
    }

    if (error) {
      return h('div.glass.neon-border.p-8.text-center', {}, [
        h('h1.text-2xl.font-semibold.text-accent-rose', {}, ['Admin panel unavailable']),
        h('p.text-sm.text-muted.mt-2', {}, [error]),
        h('a.btn-ghost.h-9.px-4.text-xs.inline-block.mt-4', { href: ROUTES.DASHBOARD, 'data-link': '' }, ['Back to dashboard']),
      ]);
    }

    const selectedCollectible = collectibles.find((x) => x.id === selectedCollectibleId) ?? collectibles[0] ?? null;

    return appShell(
      h('div.flex.flex-col.gap-5', {}, [
        h('div.flex.flex-col.gap-2', {}, [
          h('h1.text-3xl.font-semibold.heading-grad', {}, ['Admin control panel']),
          h('p.text-sm.text-muted.max-w-4xl', {}, [
            'All mutations below are executed through security-definer RPCs. Banned users are hidden from leaderboards and suspended at the session layer.',
          ]),
        ]),

        h('div.grid.grid-cols-2.lg:grid-cols-4.gap-3', {}, [
          summaryCard('Total users', String(users.length), 'text-accent-cyan'),
          summaryCard('Active users', String(activeUserCount()), 'text-accent-lime'),
          summaryCard('Banned users', String(banned.length), 'text-accent-rose'),
          summaryCard('Collectibles', String(totalCollectibles), 'text-accent-amber'),
        ]),

        // ── Rotation controls ──────────────────────────────────────────────
        rotationPanel(),

        h('div.grid.grid-cols-1.lg:grid-cols-2.gap-4', {}, [
          h('section.glass.neon-border.p-5.flex.flex-col.gap-4', {}, [
            h('div.flex.items-center.justify-between.gap-3.flex-wrap', {}, [
              h('div', {}, [
                h('h2.text-xl.font-semibold.heading-grad', {}, ['Credit grants']),
                h('p.text-xs.text-muted', {}, ['Grant balances to one user, all users, or only users with 0 credits.']),
              ]),
              h('span.text-[10px].uppercase.tracking-widest.text-muted', {}, [`Starting amount: ${ECONOMY.STARTING_CREDITS}`]),
            ]),
            field('Grant amount', (creditsAmountInput = h('input.input', { type: 'number', min: '1', value: String(ECONOMY.STARTING_CREDITS) })), 'Used for single-user and global grants'),
            field('Note', (creditNoteInput = h('input.input', { placeholder: 'Optional ledger note' })), 'Stored in the admin grant transaction metadata'),
            field('Target user', buildUserSelect(), 'Used for the per-user credit grant button below'),
            h('div.flex.flex-wrap.gap-2', {}, [
              h('button.btn-primary.h-10.px-4', { onclick: () => doCreditGrant(selectedUserId) }, [`Grant to ${selectedUserLabel()}`]),
              h('button.btn-primary.h-10.px-4', { onclick: () => doCreditGrant(null, { zeroOnly: true }) }, ['Top up zero-credit users']),
              h('button.btn-ghost.h-10.px-4', { onclick: () => doCreditGrant(null, { allUsers: true }) }, ['Grant to all users']),
            ]),
            h('div.text-[11px].text-muted', {}, [
              `Zero-credit users: ${zeroCreditCount}`,
            ]),
          ]),

          h('section.glass.neon-border.p-5.flex.flex-col.gap-4', {}, [
            h('div.flex.items-center.justify-between.gap-3.flex-wrap', {}, [
              h('div', {}, [
                h('h2.text-xl.font-semibold.heading-grad', {}, ['Collectibles']),
                h('p.text-xs.text-muted', {}, ['Grant any cosmetic/trophy to one user or the whole platform.']),
              ]),
              selectedCollectible
                ? h('span.text-xs.text-muted', {}, [selectedCollectible.is_unique ? 'Unique item' : 'Repeatable item'])
                : null,
            ]),
            field('Collectible', (function buildSelect() {
              const el = h('select.input', {}, collectibles.map((item) => h('option', { value: item.id }, [`${item.name} · ${item.rarity}`])));
              el.value = selectedCollectibleId || collectibles[0]?.id || '';
              el.onchange = () => { selectedCollectibleId = el.value; redraw(); };
              return el;
            })(), 'Only cosmetics and trophies are shown here'),
            field('Quantity', (collectibleQtyInput = h('input.input', { type: 'number', min: '1', value: '1' })), 'Repeatable collectibles can be granted in stacks'),
            field('Note', (collectibleNoteInput = h('input.input', { placeholder: 'Optional grant note' })), 'Stored in the admin grant metadata'),
            field('Target user', buildUserSelect(), 'Used for the per-user collectible grant button below'),
            h('div.flex.flex-wrap.gap-2', {}, [
              h('button.btn-primary.h-10.px-4', { onclick: () => doGrantCollectible(selectedUserId, { allUsers: false }) }, [`Grant to ${selectedUserLabel()}`]),
              h('button.btn-ghost.h-10.px-4', { onclick: () => doGrantCollectible(null, { allUsers: true }) }, ['Grant to all users']),
            ]),
            selectedCollectible
              ? h('div.text-[11px].text-muted', {}, [
                  `${selectedCollectible.name} · ${selectedCollectible.category} · ${selectedCollectible.is_unique ? 'one-of-one' : 'repeatable'}`,
                ])
              : null,
          ]),
        ]),

        h('section.glass.neon-border.p-5.flex.flex-col.gap-4', {}, [
          h('div.flex.items-center.justify-between.gap-3.flex-wrap', {}, [
            h('div', {}, [
              h('h2.text-xl.font-semibold.heading-grad', {}, ['Suspensions']),
              h('p.text-xs.text-muted', {}, ['Suspended accounts are hidden from leaderboards and blocked from normal access.']),
            ]),
            h('div.flex.items-center.gap-2', {}, [
              h('span.text-[10px].text-muted.uppercase.tracking-widest', {}, ['Ban reason']),
            ]),
          ]),
          field('Filter users', (userSearchInput = h('input.input', {
            value: userSearch,
            placeholder: 'Search by name, email or reason',
            oninput: () => {
              userSearch = userSearchInput.value;
              redraw();
            },
          })), 'Type to narrow the table below'),
          field('Ban reason', (banReasonInput = h('input.input', { placeholder: 'Required when suspending' })), 'Used when suspending a user'),
          h('div.flex.flex-col.gap-2.max-h-[28rem].overflow-auto.pr-1', {}, visible.map((user) => userRow(user))),
          banned.length > 0
            ? h('div.flex.flex-col.gap-2', {}, [
                h('h3.text-sm.uppercase.tracking-widest.text-muted', {}, ['Banned users']),
                h('div.flex.flex-col.gap-2', {}, banned.map((user) => bannedUserRow(user))),
              ])
            : null,
        ]),

        h('section.glass.neon-border.p-5.flex.flex-col.gap-4.border-accent-rose/30', {}, [
          h('div.flex.items-center.justify-between.gap-3.flex-wrap', {}, [
            h('div', {}, [
              h('h2.text-xl.font-semibold.heading-grad', {}, ['Full reset']),
              h('p.text-xs.text-muted', {}, [
                'Wipes transactional history, game history, collectibles, auctions, leaderboards and gacha claims, then restores every profile to the starting credit amount.',
              ]),
            ]),
            h('span.text-[10px].uppercase.tracking-widest.text-accent-rose', {}, ['Danger zone']),
          ]),
          field('Type RESET ALL to confirm', (resetConfirmInput = h('input.input', { placeholder: 'RESET ALL' })), 'This action is intentionally hard to trigger'),
          h('div.flex.justify-end', {}, [
            h('button.btn-danger.h-11.px-5', { onclick: doResetAll }, ['Reset everything']),
          ]),
        ]),
      ])
    );
  }

  function userRow(user) {
    const isBanned = !!user.is_banned;
    const color = isBanned ? '#ff6d8a' : '#22e1ff';
    return h('div.glass.neon-border.p-4.flex.flex-col.gap-3', {
      style: {
        borderColor: `${color}44`,
        boxShadow: `0 0 18px ${color}22`,
        opacity: isBanned ? 0.9 : 1,
      },
    }, [
      h('div.flex.items-start.justify-between.gap-3.flex-wrap', {}, [
        h('div.flex.items-center.gap-3.min-w-0', {}, [
          h('div.w-11.h-11.rounded-xl.flex.items-center.justify-center.font-bold.shrink-0', {
            style: {
              background: user.avatar_url ? `center/cover no-repeat url(${user.avatar_url})` : 'linear-gradient(145deg,#182033,#0a0d14)',
              border: `1px solid ${color}55`,
              boxShadow: `0 0 14px ${color}22`,
            },
            title: shortName(user.display_name, user.email),
          }, user.avatar_url ? [] : [initials(user.display_name, user.email)]),
          h('div.min-w-0', {}, [
            h('div.flex.items-center.gap-2.flex-wrap', {}, [
              h('div.font-semibold.truncate', {}, [shortName(user.display_name, user.email)]),
              user.is_admin ? h('span.chip.bg-accent-magenta/15.border-accent-magenta/40.text-accent-magenta', {}, ['ADMIN']) : null,
              isBanned ? h('span.chip.bg-accent-rose/15.border-accent-rose/40.text-accent-rose', {}, ['BANNED']) : null,
            ]),
            h('div.text-[11px].text-muted.truncate', {}, [user.email]),
            user.ban_reason
              ? h('div.text-[11px].text-accent-rose.mt-1.line-clamp-2', {}, [
                  `Reason: ${user.ban_reason}`,
                ])
              : null,
          ]),
        ]),
        h('div.text-right', {}, [
          h('div.text-lg.font-mono.font-semibold', {}, [formatCredits(user.credits ?? 0)]),
          h('div.text-[10px].text-muted.uppercase.tracking-widest', {}, [
            `${user.items_unique ?? 0} unique · ${user.items_total ?? 0} total · ${user.cases_opened ?? 0} cases`,
          ]),
        ]),
      ]),
      h('div.grid.grid-cols-2.lg:grid-cols-4.gap-2.text-[11px]', {}, [
        statMini('Peak', formatCredits(user.peak_credits ?? 0)),
        statMini('Won', formatCredits(user.total_won ?? 0)),
        statMini('Wagered', formatCredits(user.total_wagered ?? 0)),
        statMini('Joined', new Date(user.created_at).toLocaleDateString()),
      ]),
      h('div.flex.flex-wrap.gap-2', {}, [
        h('button.btn-primary.h-9.px-3.text-xs', { onclick: () => doCreditGrant(user.id) }, [`Grant ${formatCredits(Number(creditsAmountInput?.value ?? ECONOMY.STARTING_CREDITS))}`]),
        isBanned
          ? h('button.btn-ghost.h-9.px-3.text-xs', { onclick: () => doBan(user, false) }, ['Unban'])
          : h('button.btn-danger.h-9.px-3.text-xs', { onclick: () => doBan(user, true) }, ['Ban user']),
        h('button.btn-ghost.h-9.px-3.text-xs', { onclick: () => doGrantCollectible(user.id) }, [selectedCollectibleLabel()]),
      ]),
    ]);
  }

  function bannedUserRow(user) {
    return h('div.glass.neon-border.p-3.flex.items-center.justify-between.gap-3.flex-wrap', {
      style: { borderColor: 'rgba(255,109,138,0.35)' },
    }, [
      h('div.min-w-0', {}, [
        h('div.font-semibold.truncate', {}, [shortName(user.display_name, user.email)]),
        h('div.text-[11px].text-muted.truncate', {}, [user.email]),
        user.ban_reason ? h('div.text-[11px].text-accent-rose.mt-1', {}, [user.ban_reason]) : null,
      ]),
      h('button.btn-ghost.h-9.px-3.text-xs', { onclick: () => doBan(user, false) }, ['Unban']),
    ]);
  }

  function selectedCollectibleLabel() {
    if (!selectedCollectibleId) return 'Grant item';
    const item = collectibles.find((x) => x.id === selectedCollectibleId);
    return item ? `Grant ${item.name}` : 'Grant item';
  }

  function selectedUserLabel() {
    const user = users.find((x) => x.id === selectedUserId);
    return user ? shortName(user.display_name, user.email) : 'Select a user';
  }

  function buildUserSelect() {
    const select = h('select.input', {}, getSelectableUsers().map((user) => {
      const label = `${shortName(user.display_name, user.email)}${user.is_banned ? ' · banned' : ''}`;
      return h('option', { value: user.id }, [label]);
    }));
    select.value = selectedUserId || users[0]?.id || '';
    select.onchange = () => {
      selectedUserId = select.value;
      redraw();
    };
    return select;
  }

  function statMini(label, value) {
    return h('div.rounded-lg.border.border-white/10.bg-white/[0.03].px-3.py-2.flex.flex-col.gap-0.5', {}, [
      h('div.text-[10px].uppercase.tracking-widest.text-muted', {}, [label]),
      h('div.font-mono.text-sm', {}, [value]),
    ]);
  }

  function field(label, input, hint) {
    return h('div.flex.flex-col.gap-1.5', {}, [
      h('label.text-xs.text-muted.uppercase.tracking-widest', {}, [label]),
      input,
      hint ? h('div.text-[11px].text-muted', {}, [hint]) : null,
    ]);
  }

  function rotationPanel() {
    const now = Date.now();
    const hasOffset = rotation.extraSlots > 0;

    function minsRemaining(endsAt) {
      const ms = new Date(endsAt).getTime() - now;
      if (ms <= 0) return '0m';
      const mins = Math.floor(ms / 60000);
      if (mins < 60) return `${mins}m`;
      return `${Math.floor(mins / 60)}h ${mins % 60}m`;
    }

    return h('section.glass.neon-border.p-5.flex.flex-col.gap-4', {
      style: { borderColor: hasOffset ? 'rgba(255,217,107,0.4)' : 'rgba(34,225,255,0.2)' },
    }, [
      h('div.flex.items-center.justify-between.gap-3.flex-wrap', {}, [
        h('div', {}, [
          h('h2.text-xl.font-semibold.heading-grad', {}, ['Game Rotation']),
          h('p.text-xs.text-muted', {}, [
            'Force-advance the 6-game rotation for all users. One slot = 1 hour of wall-clock time.',
          ]),
        ]),
        hasOffset
          ? h('span.text-[10px].uppercase.tracking-widest.px-2.py-0.5.rounded', {
              style: { background: 'rgba(255,217,107,0.15)', color: '#ffd96b',
                       border: '1px solid rgba(255,217,107,0.4)' },
            }, [`+${rotation.extraSlots} slot${rotation.extraSlots !== 1 ? 's' : ''} offset`])
          : h('span.text-[10px].uppercase.tracking-widest.text-muted', {}, ['Wall-clock time']),
      ]),

      // Active games grid
      rotation.games.length > 0
        ? h('div.grid.grid-cols-2.sm:grid-cols-3.lg:grid-cols-6.gap-2', {},
            rotation.games.map((g) => {
              const name = GAME_DISPLAY_NAMES[g.gameId] ?? g.gameId;
              const remaining = minsRemaining(g.endsAt);
              return h('div.rounded-xl.p-3.flex.flex-col.items-center.gap-1.text-center', {
                style: {
                  background: 'rgba(34,225,255,0.05)',
                  border: '1px solid rgba(34,225,255,0.2)',
                },
              }, [
                h('span.text-sm.font-semibold.text-white', {}, [name]),
                h('span.text-[10px].text-muted.font-mono', {}, [`⏱ ${remaining}`]),
              ]);
            })
          )
        : h('p.text-sm.text-muted', {}, ['Loading rotation…']),

      // Note about active sessions
      h('p.text-[11px].text-muted.italic', {}, [
        '⚡ Active sessions are not interrupted: players mid-game finish and collect winnings naturally. ' +
        'The new rotation takes effect for new page loads only.',
      ]),

      // Action buttons
      h('div.flex.flex-wrap.gap-2', {}, [
        h('button', {
          class: 'h-10 px-4 rounded-lg text-sm font-semibold transition-colors ' +
                 (rotationBusy
                   ? 'bg-white/5 text-white/40 cursor-not-allowed'
                   : 'bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30'),
          onclick: doAdvanceRotation,
          disabled: rotationBusy,
        }, [rotationBusy ? 'Working…' : '⏩ Advance by 1 slot']),
        hasOffset
          ? h('button.btn-ghost.h-10.px-4', {
              onclick: doResetRotationOffset,
              disabled: rotationBusy,
            }, ['↺ Reset to wall-clock'])
          : null,
      ]),
    ]);
  }

  function summaryCard(label, value, color = 'text-white') {
    return h('div.glass.neon-border.p-4.flex.flex-col.gap-1', {}, [
      h('span.text-[10px].text-muted.uppercase.tracking-widest', {}, [label]),
      h(`span.font-mono.text-lg.tabular-nums.${color}`, {}, [value]),
    ]);
  }

  return root;
}
