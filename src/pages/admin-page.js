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
  adminGetWarfrontOverrides,
  adminSaveWarfrontOverrides,
} from '../services/admin-service.js';
import { WARFRONT_FANTASY_UNITS, WARFRONT_ANIMAL_UNITS } from '../games/warfront/warfront-api.js';

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

  // Warfront override state
  let wfTab = 'fantasy';
  let wfBusy = false;
  let wfPoolOverride = { fantasy: null, animals: null };
  let wfStatOverrides = { fantasy: {}, animals: {} };

  const root = h('div.max-w-7xl.mx-auto.w-full.flex.flex-col.gap-5', {}, []);
  const redraw = () => mount(root, view());

  loadData();

  async function loadData() {
    loading = true;
    error = null;
    redraw();
    try {
      const [nextUsers, nextCollectibles, nextRotation, nextWfOvr] = await Promise.all([
        fetchAdminUsers(),
        fetchAdminCollectibles(),
        adminGetRotation().catch(() => ({ games: [], extraSlots: 0 })),
        adminGetWarfrontOverrides().catch(() => ({ fantasyPool: null, animalPool: null, fantasyStats: {}, animalStats: {} })),
      ]);
      users = nextUsers;
      collectibles = nextCollectibles.filter((item) => COLLECTIBLE_CATEGORIES.has(item.category));
      rotation = nextRotation;
      wfPoolOverride = { fantasy: nextWfOvr.fantasyPool, animals: nextWfOvr.animalPool };
      wfStatOverrides = { fantasy: { ...(nextWfOvr.fantasyStats || {}) }, animals: { ...(nextWfOvr.animalStats || {}) } };
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

  async function doSaveWarfrontOverrides() {
    if (wfBusy) return;
    wfBusy = true; redraw();
    try {
      await adminSaveWarfrontOverrides({
        fantasyPool:  wfPoolOverride.fantasy,
        animalPool:   wfPoolOverride.animals,
        fantasyStats: wfStatOverrides.fantasy || {},
        animalStats:  wfStatOverrides.animals || {},
      });
      toastSuccess('Warfront overrides saved');
    } catch (e) {
      toastError(e.message ?? String(e));
    } finally {
      wfBusy = false; redraw();
    }
  }

  async function doResetWarfrontOverrides() {
    if (wfBusy) return;
    if (!window.confirm('Clear ALL warfront overrides (pool + stats) for both collections? Players will return to automatic rotation.')) return;
    wfBusy = true; redraw();
    try {
      await adminSaveWarfrontOverrides({ fantasyPool: null, animalPool: null, fantasyStats: {}, animalStats: {} });
      wfPoolOverride = { fantasy: null, animals: null };
      wfStatOverrides = { fantasy: {}, animals: {} };
      toastSuccess('All warfront overrides cleared');
    } catch (e) {
      toastError(e.message ?? String(e));
    } finally {
      wfBusy = false; redraw();
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

        // ── Warfront admin ─────────────────────────────────────────────────
        warfrontPanel(),

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

  function wfStatCell(unit, field, overrideVal, min, max, isFloat = false) {
    const defaultVal = unit[field];
    const value = overrideVal ?? defaultVal;
    const isModified = overrideVal !== undefined && overrideVal !== defaultVal;
    return h('td.py-1.px-1.text-center', {}, [
      h('input', {
        type: 'number',
        min: String(min), max: String(max),
        step: isFloat ? '0.1' : '1',
        value: String(value),
        style: {
          width: '60px', padding: '3px 5px', textAlign: 'center', fontFamily: 'monospace', fontSize: '12px',
          background: isModified ? 'rgba(255,217,107,0.18)' : 'rgba(255,255,255,0.05)',
          border: `1px solid ${isModified ? 'rgba(255,217,107,0.55)' : 'rgba(255,255,255,0.14)'}`,
          borderRadius: '5px', color: isModified ? '#ffd96b' : 'rgba(255,255,255,0.7)',
        },
        oninput: (e) => {
          const v = isFloat ? Number.parseFloat(e.target.value) : Number.parseInt(e.target.value, 10);
          if (!wfStatOverrides[wfTab]) wfStatOverrides[wfTab] = {};
          if (!wfStatOverrides[wfTab][unit.id]) wfStatOverrides[wfTab][unit.id] = {};
          if (Number.isFinite(v) && v >= min) wfStatOverrides[wfTab][unit.id][field] = v;
        },
      }),
    ]);
  }

  function warfrontPanel() {
    const units = wfTab === 'fantasy' ? WARFRONT_FANTASY_UNITS : WARFRONT_ANIMAL_UNITS;
    const pool  = wfPoolOverride[wfTab];
    const stats = wfStatOverrides[wfTab] || {};
    const hasStatOverrides = Object.keys(stats).length > 0;
    const hasBothOverrides = (wfPoolOverride.fantasy !== null || wfPoolOverride.animals !== null || hasStatOverrides);

    return h('section.glass.neon-border.p-5.flex.flex-col.gap-5', {
      style: { borderColor: hasBothOverrides ? 'rgba(255,140,40,0.4)' : 'rgba(34,225,255,0.2)' },
    }, [
      // ── Header ──────────────────────────────────────────────────────────
      h('div.flex.items-start.justify-between.gap-3.flex-wrap', {}, [
        h('div', {}, [
          h('h2.text-xl.font-semibold.heading-grad', {}, ['⚔ Warfront Controls']),
          h('p.text-xs.text-muted', {}, ['Override the active unit pool and base stats for every player.']),
        ]),
        hasBothOverrides
          ? h('span.text-[10px].uppercase.tracking-widest.px-2.py-0.5.rounded', {
              style: { background: 'rgba(255,140,40,0.15)', color: '#ff8c28', border: '1px solid rgba(255,140,40,0.4)' },
            }, ['Overrides active'])
          : h('span.text-[10px].uppercase.tracking-widest.text-muted', {}, ['No overrides']),
      ]),

      // ── Collection tabs ──────────────────────────────────────────────────
      h('div.flex.gap-2', {}, [
        h('button', {
          class: 'h-8 px-4 rounded-lg text-sm font-semibold transition-colors border ' +
            (wfTab === 'fantasy'
              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
              : 'bg-transparent text-white/50 border-white/10 hover:border-white/25 hover:text-white/75'),
          onclick: () => { wfTab = 'fantasy'; redraw(); },
        }, ['✨ Fantasy']),
        h('button', {
          class: 'h-8 px-4 rounded-lg text-sm font-semibold transition-colors border ' +
            (wfTab === 'animals'
              ? 'bg-lime-500/20 text-lime-300 border-lime-500/40'
              : 'bg-transparent text-white/50 border-white/10 hover:border-white/25 hover:text-white/75'),
          onclick: () => { wfTab = 'animals'; redraw(); },
        }, ['🐾 Animals']),
      ]),

      // ── Unit pool ────────────────────────────────────────────────────────
      h('div.flex.flex-col.gap-3', {}, [
        h('div.flex.items-center.justify-between.gap-2.flex-wrap', {}, [
          h('div.flex.items-center.gap-2', {}, [
            h('span.text-xs.uppercase.tracking-widest.text-muted', {}, ['Active pool']),
            pool === null
              ? h('span.text-[10px].px-2.py-0.5.rounded', {
                  style: { background: 'rgba(34,225,255,0.1)', color: '#22e1ff', border: '1px solid rgba(34,225,255,0.3)' },
                }, ['Auto rotation'])
              : h('span.text-[10px].px-2.py-0.5.rounded', {
                  style: { background: 'rgba(255,217,107,0.15)', color: '#ffd96b', border: '1px solid rgba(255,217,107,0.4)' },
                }, [`Manual · ${pool.length} unit${pool.length !== 1 ? 's' : ''}`]),
          ]),
          pool !== null
            ? h('button.btn-ghost.h-7.px-3.text-xs', {
                onclick: () => { wfPoolOverride = { ...wfPoolOverride, [wfTab]: null }; redraw(); },
              }, ['↺ Reset to auto'])
            : h('button.btn-ghost.h-7.px-3.text-xs', {
                onclick: () => {
                  wfPoolOverride = { ...wfPoolOverride, [wfTab]: units.map((u) => u.id) };
                  redraw();
                },
              }, ['Customize pool']),
        ]),
        h('div.flex.flex-wrap.gap-1.5', {}, units.map((u) => {
          const active = pool === null || pool.includes(u.id);
          return h('button', {
            style: {
              display: 'flex', alignItems: 'center', gap: '5px',
              height: '30px', padding: '0 10px', borderRadius: '7px',
              fontSize: '11px', fontWeight: '600', cursor: 'pointer',
              transition: 'all .15s',
              border: active ? '1px solid rgba(255,255,255,0.25)' : '1px solid rgba(255,255,255,0.07)',
              background: active ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.02)',
              color: active ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.25)',
              textDecoration: active ? 'none' : 'line-through',
            },
            onclick: () => {
              if (pool === null) {
                wfPoolOverride = { ...wfPoolOverride, [wfTab]: units.map((u2) => u2.id).filter((id) => id !== u.id) };
              } else {
                const next = pool.includes(u.id) ? pool.filter((id) => id !== u.id) : [...pool, u.id];
                wfPoolOverride = { ...wfPoolOverride, [wfTab]: next };
              }
              redraw();
            },
          }, [
            h('span', {}, [u.icon]),
            h('span', {}, [u.name]),
            active && pool !== null ? h('span', { style: { color: '#4dff9a', marginLeft: '2px' } }, ['✓']) : null,
          ]);
        })),
        pool !== null
          ? h('p.text-[11px].text-muted.italic', {}, ['Click a unit to toggle it in or out of the pool. Changes take effect on save.'])
          : h('p.text-[11px].text-muted.italic', {}, ['Click "Customize pool" to manually pick which units are available.']),
      ]),

      // ── Stat overrides ───────────────────────────────────────────────────
      h('div.flex.flex-col.gap-2', {}, [
        h('div.flex.items-center.justify-between.gap-2', {}, [
          h('span.text-xs.uppercase.tracking-widest.text-muted', {}, ['Stat overrides']),
          hasStatOverrides
            ? h('button.btn-ghost.h-7.px-3.text-xs', {
                onclick: () => { wfStatOverrides = { ...wfStatOverrides, [wfTab]: {} }; redraw(); },
              }, [`↺ Clear ${wfTab} stats`])
            : h('span.text-[11px].text-muted.italic', {}, ['No overrides — showing defaults']),
        ]),
        h('div.rounded-xl.border.border-white/[0.08].overflow-x-auto', {}, [
          h('table.w-full', { style: { borderCollapse: 'collapse', fontSize: '12px', minWidth: '480px' } }, [
            h('thead', {}, [
              h('tr', { style: { borderBottom: '1px solid rgba(255,255,255,0.08)' } }, [
                h('th', { style: { textAlign: 'left', padding: '8px 12px', color: 'rgba(160,185,230,0.6)', fontWeight: '400', fontSize: '10px', letterSpacing: '0.05em', textTransform: 'uppercase' } }, ['Unit']),
                ...['HP', 'DMG', 'SPD', 'ATK/s', 'Cost'].map((lbl) =>
                  h('th', { style: { textAlign: 'center', padding: '8px 4px', color: 'rgba(160,185,230,0.6)', fontWeight: '400', fontSize: '10px', letterSpacing: '0.05em', textTransform: 'uppercase' } }, [lbl])
                ),
              ]),
            ]),
            h('tbody', {}, units.map((u, i) => {
              const uStats = stats[u.id] || {};
              const modified = Object.keys(uStats).length > 0;
              return h('tr', {
                style: {
                  background: i % 2 === 0 ? 'rgba(255,255,255,0.018)' : 'transparent',
                  borderLeft: modified ? '2px solid rgba(255,217,107,0.45)' : '2px solid transparent',
                },
              }, [
                h('td', { style: { padding: '4px 12px', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' } }, [
                  h('span', { style: { fontSize: '14px' } }, [u.icon]),
                  h('span', { style: { color: 'rgba(255,255,255,0.75)' } }, [u.name]),
                  h('span', { style: { fontSize: '10px', color: 'rgba(160,160,160,0.6)', marginLeft: '2px' } }, [`${u.cost}g`]),
                  modified ? h('span', { style: { fontSize: '9px', color: '#ffd96b', marginLeft: '4px' } }, ['✦']) : null,
                ]),
                wfStatCell(u, 'hp',      uStats.hp,      1,   9999),
                wfStatCell(u, 'dmg',     uStats.dmg,     0,   999),
                wfStatCell(u, 'spd',     uStats.spd,     1,   999),
                wfStatCell(u, 'atkRate', uStats.atkRate,  0.1, 99, true),
                wfStatCell(u, 'cost',    uStats.cost,    1,   10),
              ]);
            })),
          ]),
        ]),
        h('p.text-[11px].text-muted.italic', {}, [
          'Highlighted cells (amber) have been changed from defaults. Edit any field and hit Save.',
        ]),
      ]),

      // ── Actions ──────────────────────────────────────────────────────────
      h('div.flex.flex-wrap.items-center.justify-end.gap-2', {}, [
        wfBusy ? h('span.text-xs.text-muted', {}, ['Saving…']) : null,
        h('button.btn-ghost.h-10.px-4', {
          onclick: doResetWarfrontOverrides, disabled: wfBusy,
        }, ['Reset all overrides']),
        h('button', {
          class: 'h-10 px-5 rounded-lg text-sm font-semibold transition-colors border ' +
            (wfBusy
              ? 'bg-white/5 text-white/30 border-white/10 cursor-not-allowed'
              : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 hover:bg-cyan-500/30'),
          onclick: doSaveWarfrontOverrides,
          disabled: wfBusy,
        }, ['💾 Save overrides']),
      ]),
    ]);
  }

  function rotationPanel() {
    const now = Date.now();
    const hasOffset = rotation.extraSlots > 0;

    function minsRemaining(endsAt) {
      // Subtract the extra_slots offset so each card shows its position within
      // the 6-slot window (0–1h for the freshest, up to 5–6h for the oldest),
      // regardless of how far the admin has advanced the rotation.
      const ms = new Date(endsAt).getTime() - now - rotation.extraSlots * 3_600_000;
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
