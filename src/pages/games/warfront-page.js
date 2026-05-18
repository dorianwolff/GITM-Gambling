import { h, mount } from '../../utils/dom.js';
import { appShell } from '../../ui/layout/app-shell.js';
import { GAMES } from '../../config/constants.js';
import { getCredits, isAdmin } from '../../state/user-store.js';
import { formatCredits } from '../../utils/format.js';
import { createBetInput } from '../../ui/components/bet-input.js';
import { toast, toastSuccess } from '../../ui/components/toast.js';
import { openModal } from '../../ui/components/modal.js';
import { supabase } from '../../lib/supabase.js';
import {
  DIFF_TABLE, getWarfrontUnits, getActiveDraftUnits, playWarfront, resolveWarfront, getUnitById,
} from '../../games/warfront/warfront-api.js';
import { flashSuccess, flashSuccessMajor, flashGold, flashLoss } from '../../ui/fx/feedback-fx.js';
import {
  renderWarfrontUnitGrid,
  renderWarfrontBattleStage,
  injectWarfrontStylesOnce,
} from '../../games/warfront/warfront-ui.js';

const PHASES = Object.freeze({ DRAFT: 'draft', BATTLE: 'battle', RESULT: 'result' });

export function renderWarfront(ctx) {
  injectWarfrontStylesOnce();

  const root = h('div.flex.flex-col.gap-4', {}, []);
  let phase = PHASES.DRAFT, bet = 10, qty = {};
  let activeCollection = 'fantasy';
  let result = null, loading = false, historyRows = [];
  let battleRaf = null;
  let battleCleanup = null;
  let betInputReady = false;
  let lastBattleSnapshot = null;
  let hudPortal = null;
  let hudInnerEl = null;
  const draftBudget = 10;

  const resetQty = (collection = activeCollection) => {
    qty = Object.fromEntries(getWarfrontUnits(collection).map((u) => [u.id, 0]));
  };

  function getDisplayUnits(collection = activeCollection) {
    if (isAdmin()) {
      return getWarfrontUnits(collection).slice().sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
    }
    return getActiveDraftUnits(collection);
  }
  resetQty();

  const betInput = createBetInput({
    value: bet,
    min: GAMES.WARFRONT.minBet,
    step: 1,
    onChange: (v) => { bet = v; if (betInputReady) redraw(); },
  });
  betInputReady = true;

  ctx.onCleanup(() => {
    if (battleRaf) cancelAnimationFrame(battleRaf);
    if (battleCleanup) battleCleanup();
    if (hudPortal) { hudPortal.remove(); hudPortal = null; hudInnerEl = null; }
  });
  function syncHud(spent, slots) {
    if (phase !== PHASES.DRAFT) {
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
    mount(hudInnerEl, h('div.wf-hud', {}, [
      h('div.wf-hud-stat', {}, [
        h('span.wf-hud-icon', {}, ['◈']),
        h('div.wf-hud-body', {}, [
          h('span.wf-hud-val.gold', {}, [`${draftBudget - spent}g`]),
          h('span.wf-hud-lbl', {}, ['gold']),
        ]),
      ]),
      h('div.wf-hud-stat', {}, [
        h('span.wf-hud-icon', {}, ['▣']),
        h('div.wf-hud-body', {}, [
          h('span.wf-hud-val.cyan', {}, [`${slots}/6`]),
          h('span.wf-hud-lbl', {}, ['slots']),
        ]),
      ]),
    ]));
    hudPortal.style.display = 'block';
  }

  const redraw = () => mount(root, view());
  redraw();

  function setPhase(p) {
    if (battleCleanup) { battleCleanup(); battleCleanup = null; }
    if (battleRaf) { cancelAnimationFrame(battleRaf); battleRaf = null; }
    phase = p;
    redraw();
  }

  function selectCollection(collection) {
    if (activeCollection === collection) return;
    activeCollection = collection;
    resetQty(collection);
    redraw();
  }

  function resetDraftState(collection = activeCollection) {
    activeCollection = collection;
    resetQty(collection);
    result = null;
    loading = false;
    setPhase(PHASES.DRAFT);
  }

  function calcSpent(collection = activeCollection) {
    return getWarfrontUnits(collection).reduce((sum, u) => sum + (qty[u.id] || 0) * u.cost, 0);
  }

  function calcSlots(collection = activeCollection) {
    return getWarfrontUnits(collection).reduce((sum, u) => sum + (qty[u.id] || 0), 0);
  }

  function changeQty(id, delta) {
    const units = getWarfrontUnits(activeCollection);
    const u = units.find((x) => x.id === id);
    if (!u) return;
    const current = qty[id] || 0;
    const next = current + delta;
    if (next < 0) return;
    const spent = calcSpent();
    const slots = calcSlots();
    const nextSpent = spent - current * u.cost + next * u.cost;
    const nextSlots = slots - current + next;
    if (nextSpent > draftBudget) { toast('Not enough draft gold', { type: 'error' }); return; }
    if (nextSlots > 6) { toast('Max 6 unit slots', { type: 'error' }); return; }
    qty[id] = next;
    redraw();
  }

  function getDraftArmy(collection = activeCollection) {
    return getWarfrontUnits(collection).flatMap((u) =>
      Array.from({ length: qty[u.id] || 0 }, () => u.id));
  }

  async function doPlay() {
    if (bet < 10) { toast('Bet at least 10 credits', { type: 'error' }); return; }
    const army = getDraftArmy();
    const cost = calcSpent();
    if (army.length === 0) { toast('Select at least one unit', { type: 'error' }); return; }
    if (cost > draftBudget) { toast('Army cost exceeds draft budget', { type: 'error' }); return; }
    if (bet > getCredits()) { toast('Not enough credits', { type: 'error' }); return; }
    lastBattleSnapshot = { collection: activeCollection, qty: { ...qty }, bet };
    loading = true; redraw();
    try {
      result = await playWarfront(bet, army, activeCollection);
      setPhase(PHASES.BATTLE);
    } catch (e) { toast(e.message || 'Battle failed', { type: 'error' }); loading = false; redraw(); }
  }

  async function endBattle(extra = null) {
    if (battleRaf) { cancelAnimationFrame(battleRaf); battleRaf = null; }
    loading = false;

    const playerBaseHp = extra?.playerBaseHp ?? result?.playerBaseHp ?? 0;
    const enemyBaseHp  = extra?.enemyBaseHp  ?? result?.enemyBaseHp  ?? 0;
    const surrendered  = !!extra?.surrendered;
    // Client-side win: enemy base destroyed and player alive
    // Win = player has strictly more HP; equal HP (tie) counts as loss
    const animWon = !surrendered && playerBaseHp > enemyBaseHp;

    // Show result immediately with animation-determined outcome — no "Resolving…" flash
    result = {
      ...(result || {}),
      playerBaseHp, enemyBaseHp, surrendered,
      won: animWon, multiplier: 0, payout: 0, resolving: false,
    };
    setPhase(PHASES.RESULT);

    // Fire loss effect immediately; win effects fire after payout is confirmed
    if (!surrendered) {
      if (!animWon) flashLoss();
    }

    if (result.gameId) {
      const resolvePlayerHp = surrendered ? 0 : playerBaseHp;
      try {
        const resolved = await resolveWarfront(result.gameId, resolvePlayerHp, enemyBaseHp);
        const won = surrendered ? false : resolved.won;
        result = { ...result, won, multiplier: resolved.multiplier, payout: resolved.payout };
        redraw();
        if (!surrendered && won && resolved.payout > 0) {
          const diff = result.enemyDifficulty;
          const label = `+${formatCredits(resolved.payout)} cr`;
          toastSuccess(`Won ${formatCredits(resolved.payout)} cr`);
          if (diff === 'Legendary' || diff === 'Impossible') {
            flashGold({ label });
          } else if (resolved.multiplier >= 2) {
            flashSuccessMajor({ label });
          } else {
            flashSuccess();
          }
        }
      } catch {
        // resolve_warfront unavailable — display is already correct from animWon
        if (!surrendered && animWon) flashSuccess();
        toast('Payout unavailable — please refresh', { type: 'error' });
      }
    } else {
      // Pre-v25 DB: no gameId, fire basic effects
      if (!surrendered && animWon) flashSuccess();
    }
    fetchHistory();
  }

  function handleBattleSurrender(stats) { endBattle({ surrendered: true, ...stats }); }

  async function playAgain() {
    if (!lastBattleSnapshot) { await doPlay(); return; }
    activeCollection = lastBattleSnapshot.collection;
    qty = { ...lastBattleSnapshot.qty };
    bet = lastBattleSnapshot.bet;
    await doPlay();
  }

  function draftAgain() { resetDraftState(activeCollection); }

  async function fetchHistory() {
    let q = supabase.from('warfront_games').select('*').order('created_at', { ascending: false }).limit(10);
    const { data, error } = await q.eq('resolved', true);
    if (error) {
      // Column may not exist yet — fall back to all records
      const fb = await supabase.from('warfront_games').select('*').order('created_at', { ascending: false }).limit(10);
      if (!fb.error) { historyRows = fb.data || []; redraw(); }
      return;
    }
    historyRows = data || []; redraw();
  }
  fetchHistory();

  function battleStage() {
    const army = getDraftArmy();
    const container = renderWarfrontBattleStage({
      picks: army, result, getUnitById, onComplete: endBattle, onSurrender: handleBattleSurrender,
    });
    battleCleanup = container._cleanup || null;
    return container;
  }

  // ── Modals ────────────────────────────────────────────────────────────────

  function openInfoModal() {
    const rows = [
      ...DIFF_TABLE.map((d) =>
        h('div.wf-rew-row', {}, [
          h('span.wf-rew-budget', {}, [`${d.budget}g`]),
          h('span.wf-rew-diff', {}, [d.name]),
          h('span.wf-rew-mult', {}, [`${d.mult.toFixed(1)}×`]),
        ])
      ),
      h('div.wf-rew-row', {}, [
        h('span.wf-rew-budget', {}, ['Any']),
        h('span.wf-rew-diff', {}, ['Defeat']),
        h('span.wf-rew-lose', {}, ['Lose bet']),
      ]),
    ];
    openModal({
      title: 'Reward Table',
      body: [
        h('p.text-xs', { style: { color: 'rgba(160,185,230,.55)', marginBottom: '10px' } },
          ['Reward multiplier based on enemy difficulty (determined by their draft budget)']),
        h('div', {}, [
          h('div.wf-rew-row', { style: { background: 'rgba(80,140,255,.08)', marginBottom: '8px' } }, [
            h('span.wf-rew-budget', { style: { fontWeight: '700', color: 'rgba(80,200,255,.8)' } }, ['Budget']),
            h('span.wf-rew-diff', { style: { fontWeight: '700', color: 'rgba(80,200,255,.8)' } }, ['Difficulty']),
            h('span', { style: { fontSize: '12px', fontWeight: '700', color: 'rgba(80,200,255,.8)' } }, ['Reward']),
          ]),
          ...rows,
        ]),
      ],
      size: 'sm',
    });
  }

  function openHistoryModal() {
    const content = historyRows.length === 0
      ? [h('p', { style: { textAlign: 'center', color: 'rgba(160,185,230,.45)', padding: '20px 0', fontSize: '13px' } }, ['No battles recorded yet'])]
      : historyRows.slice(0, 10).map((r) => {
          const won = r.payout > 0;
          const diff = r.enemy_difficulty;
          return h('div.wf-hist-row', {}, [
            h('span.wf-hist-time', {}, [new Date(r.created_at).toLocaleTimeString()]),
            h('span.wf-hist-bet', {}, [`Bet ${r.bet}`]),
            h('span', { class: won ? 'wf-hist-win' : 'wf-hist-loss' }, [won ? 'WIN' : 'LOSS']),
            h('span.wf-hist-score', {}, [`${r.player_base_hp} - ${r.enemy_base_hp}`]),
            diff
              ? h('span', {
                  class: `wf-diff-chip ${diff}`,
                  style: { fontSize: '9px', padding: '1px 6px', alignSelf: 'center' },
                }, [diff])
              : null,
          ]);
        });
    openModal({
      title: 'Recent Battles',
      body: [h('div', {}, content)],
      size: 'sm',
    });
  }

  // ── Main view ─────────────────────────────────────────────────────────────

  function view() {
    const bal = h('div.text-xs.text-right', { style: { color: 'rgba(160,185,230,.5)' } },
      [`Balance: ${formatCredits(getCredits())} cr`]);

    // ── DRAFT ──────────────────────────────────────────────────────────────
    if (phase === PHASES.DRAFT) {
      const spent = calcSpent();
      const slots = calcSlots();
      syncHud(spent, slots);

      return appShell(h('div.flex.flex-col.gap-4.p-4', {}, [
        // Spacer must be first — reserves layout space for the fixed-position HUD portal
        h('div.wf-hud-spacer', {}, []),

        // Title row + action buttons
        h('div.flex.items-center.justify-between', {}, [
          h('h2.text-2xl.font-bold.text-white', {}, ['⚔ Warfront']),
          h('div.flex.gap-2', {}, [
            h('button.wf-icon-btn', { title: 'Reward table', onClick: openInfoModal }, ['ℹ']),
            h('button.wf-icon-btn', { title: 'Match history', onClick: openHistoryModal }, ['📋']),
            h('button.wf-icon-btn', {
              title: 'PvP Mode',
              onClick: () => ctx.navigate('/games/warfront-pvp'),
              style: { background: 'rgba(176,107,255,0.15)', border: '1px solid rgba(176,107,255,0.5)' },
            }, ['⚔']),
          ]),
        ]),

        h('p.text-white/60.text-sm', {}, ['Draft up to 6 units. Draft budget is fixed at 10 gold. Your wager is separate.']),
        betInput.el,

        // Collection selector
        h('div.grid.grid-cols-2.gap-2', {}, [
          h('button.wf-col-btn', {
            class: activeCollection === 'fantasy' ? 'wf-col-btn active fantasy' : 'wf-col-btn fantasy',
            onClick: () => selectCollection('fantasy'),
          }, ['⚔ Fantasy']),
          h('button.wf-col-btn', {
            class: activeCollection === 'animals' ? 'wf-col-btn active animals' : 'wf-col-btn animals',
            onClick: () => selectCollection('animals'),
          }, ['🐾 Animals']),
        ]),

        h('p.text-xs.text-white/40.text-center', {}, ['12 units in rotation · pool refreshes each time warfront enters the game rotation']),

        renderWarfrontUnitGrid({
          qty,
          budget: draftBudget,
          units: getDisplayUnits(activeCollection),
          maxSlots: 6,
          onQtyChange: changeQty,
        }),

        h('div.army-sticky', {}, [
          h('div.roster', {},
            getDraftArmy().length
              ? getDraftArmy().map((id) => h('span.roster-chip', {}, [getUnitById(id)?.icon || '•']))
              : [h('span.roster-empty', {}, ['No units selected yet'])]),
          h('button.btn-main', { onClick: doPlay, disabled: calcSlots() === 0 || loading },
            [loading ? 'Deploying…' : '⚔ Deploy Army']),
        ]),
      ]), { wide: true });
    }

    // ── BATTLE ─────────────────────────────────────────────────────────────
    if (phase === PHASES.BATTLE) {
      syncHud();
      return appShell(h('div.flex.flex-col.gap-4.p-4', {}, [bal, battleStage()]), { wide: true });
    }

    // ── RESULT ─────────────────────────────────────────────────────────────
    if (phase === PHASES.RESULT) {
      syncHud();

      // "Play Again" was clicked — show clean deploying screen instead of stale result
      if (loading) {
        return appShell(h('div', {
          style: { padding: '64px 16px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' },
        }, [
          h('span', { style: { fontSize: '48px', lineHeight: '1' } }, ['⚔']),
          h('p', { style: { fontFamily: "'Cinzel',serif", color: '#80cfff', letterSpacing: '3px', fontSize: '13px' } }, ['Deploying Army…']),
        ]), { wide: true });
      }

      const resolving = !!result?.resolving;
      const won = result?.won;
      const surrendered = !!result?.surrendered;
      const mult = result?.multiplier || 0;
      const payout = result?.payout || 0;
      const pHp = result?.playerBaseHp ?? 0;
      const eHp = result?.enemyBaseHp ?? 0;
      const diff = result?.enemyDifficulty;

      const cardClass = resolving ? 'resolving' : surrendered ? 'surrender' : won ? 'win' : 'loss';
      const emoji = resolving ? '⏳' : surrendered ? '🏳' : won ? '🏆' : '💀';
      const label = resolving ? 'Resolving' : surrendered ? 'Surrendered' : won ? 'Victory' : 'Defeat';
      const subLabel = resolving ? 'Calculating outcome…' : surrendered ? 'Better luck next time' : won ? 'Enemy base destroyed' : 'Your base has fallen';

      const playAgainLabel = loading ? 'Deploying…' : ('Play Again · ' + formatCredits(lastBattleSnapshot?.bet ?? bet) + ' cr');

      return appShell(h('div.flex.flex-col.gap-4.p-4', {}, [
        // Header
        h('div.flex.items-center.justify-between', {}, [
          h('h2', { style: { fontFamily: "'Cinzel',serif", fontSize: '20px', fontWeight: '700', color: '#c0b0f0', letterSpacing: '2px' } }, ['⚔ Warfront']),
          h('button.wf-icon-btn', { title: 'Match history', onClick: openHistoryModal }, ['📋']),
        ]),

        // Result card
        h('div', { class: `wf-result ${cardClass}` }, [
          h('div.wf-result-scan', {}, []),

          h('span.wf-result-emoji', {}, [emoji]),
          h('span.wf-result-title', {}, [label]),
          h('p.wf-result-sub', {}, [subLabel]),

          // Difficulty chip (skip while resolving)
          diff && !resolving ? h('span', { class: `wf-diff-chip ${diff}` }, [diff]) : null,

          // HP scoreboard
          !resolving ? h('div.wf-scoreboard', {}, [
            h('div.wf-score-box.player', {}, [
              h('span.wf-score-val', {}, [String(pHp)]),
              h('span.wf-score-lbl', {}, ['Your Base']),
            ]),
            h('div.wf-score-vs', {}, ['vs']),
            h('div.wf-score-box.enemy', {}, [
              h('span.wf-score-val', {}, [String(eHp)]),
              h('span.wf-score-lbl', {}, ['Enemy Base']),
            ]),
          ]) : null,

          // Payout banner (win only)
          won && !resolving ? h('div.wf-payout-banner', {}, [
            h('span.wf-payout-amount', {}, [`+${formatCredits(payout)} cr`]),
            h('span.wf-payout-mult', {}, [`${mult.toFixed(2)}× multiplier · ${diff || ''}`]),
          ]) : null,
        ]),

        // Action buttons
        h('div.wf-result-btns', {}, [
          h('button.wf-btn-ghost', { onClick: playAgain, disabled: loading || resolving },
            [playAgainLabel]),
          h('button.wf-btn-accent', { onClick: draftAgain, disabled: resolving }, ['Draft Again']),
        ]),
      ]), { wide: true });
    }

    return appShell(h('div.p-4', {}, ['Unknown phase']), { wide: true });
  }

  return root;
}
