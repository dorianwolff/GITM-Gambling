import { h, mount } from '../../utils/dom.js';
import { appShell } from '../../ui/layout/app-shell.js';
import { GAMES } from '../../config/constants.js';
import { getCredits } from '../../state/user-store.js';
import { formatCredits } from '../../utils/format.js';
import { createBetInput } from '../../ui/components/bet-input.js';
import { toast } from '../../ui/components/toast.js';
import { supabase } from '../../lib/supabase.js';
import { DIFF_TABLE, getWarfrontUnits, playWarfront, getUnitById } from '../../games/warfront/warfront-api.js';
import {
  renderWarfrontRewardLadder,
  renderWarfrontUnitGrid,
  renderWarfrontHistoryWidget,
  renderWarfrontBattleStage,
} from '../../games/warfront/warfront-ui.js';

const PHASES = Object.freeze({ DRAFT:'draft', BATTLE:'battle', RESULT:'result' });

export function renderWarfront(ctx) {
  const root = h('div.flex.flex-col.gap-4', {}, []);
  let phase = PHASES.DRAFT, bet = 10, qty = {};
  let activeCollection = 'fantasy';
  let result = null, loading = false, historyRows = [];
  let battleRaf = null;
  let battleCleanup = null;
  let betInputReady = false;
  let lastBattleSnapshot = null;
  const draftBudget = 10;

  const resetQty = (collection = activeCollection) => {
    qty = Object.fromEntries(getWarfrontUnits(collection).map((u) => [u.id, 0]));
  };
  resetQty();

  const betInput = createBetInput({
    value: bet,
    min: GAMES.WARFRONT.minBet,
    step: 1,
    onChange: (v) => {
      bet = v;
      if (betInputReady) redraw();
    },
  });
  betInputReady = true;

  ctx.onCleanup(() => { if (battleRaf) cancelAnimationFrame(battleRaf); if (battleCleanup) battleCleanup(); });
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
    return getWarfrontUnits(collection).flatMap((u) => Array.from({ length: qty[u.id] || 0 }, () => u.id));
  }

  async function doPlay() {
    if (bet < 10) { toast('Bet at least 10 credits', { type: 'error' }); return; }
    const army = getDraftArmy();
    const cost = calcSpent();
    if (army.length===0) { toast('Select at least one unit', { type: 'error' }); return; }
    if (cost>draftBudget) { toast('Army cost exceeds draft budget', { type: 'error' }); return; }
    if (bet>getCredits()) { toast('Not enough credits', { type: 'error' }); return; }
    lastBattleSnapshot = { collection: activeCollection, qty: { ...qty }, bet };
    loading = true; redraw();
    try {
      result = await playWarfront(bet, army, activeCollection);
      setPhase(PHASES.BATTLE);
    } catch(e) { toast(e.message || 'Battle failed', { type: 'error' }); loading=false; redraw(); }
  }

  function endBattle(extra = null) {
    if(battleRaf){cancelAnimationFrame(battleRaf);battleRaf=null;}
    loading = false;
    if (extra?.surrendered) {
      result = {
        ...(result || {}),
        won: false,
        surrendered: true,
        multiplier: 0,
        payout: 0,
        playerBaseHp: extra.playerBaseHp ?? result?.playerBaseHp ?? 0,
        enemyBaseHp: extra.enemyBaseHp ?? result?.enemyBaseHp ?? 0,
      };
    } else if (extra) {
      result = {
        ...(result || {}),
        playerBaseHp: extra.playerBaseHp ?? result?.playerBaseHp ?? 0,
        enemyBaseHp: extra.enemyBaseHp ?? result?.enemyBaseHp ?? 0,
      };
    }
    setPhase(PHASES.RESULT);
    fetchHistory();
  }

  function handleBattleSurrender(stats) {
    endBattle({ surrendered: true, ...stats });
  }

  async function playAgain() {
    if (!lastBattleSnapshot) {
      await doPlay();
      return;
    }
    activeCollection = lastBattleSnapshot.collection;
    qty = { ...lastBattleSnapshot.qty };
    bet = lastBattleSnapshot.bet;
    await doPlay();
  }

  function draftAgain() {
    resetDraftState(activeCollection);
  }

  async function fetchHistory() {
    const { data, error } = await supabase.from('warfront_games').select('*').order('created_at',{ascending:false}).limit(10);
    if(!error){historyRows=data||[];redraw();}
  }
  fetchHistory();

  function battleStage() {
    const army = getDraftArmy();
    const container = renderWarfrontBattleStage({ picks: army, result, getUnitById, onComplete: endBattle, onSurrender: handleBattleSurrender });
    battleCleanup = container._cleanup || null;
    return container;
  }

  // ----- main view ----------------------------------------------------------
  function view() {
    const bal = h('div.text-sm.text-white/70.text-right',{},[`Balance: ${formatCredits(getCredits())} cr`]);
    const title = h('h2.text-2xl.font-bold.text-white',{},['⚔ Warfront']);

    if (phase===PHASES.DRAFT) {
      return appShell(h('div.flex.flex-col.gap-4.p-4',{},[
        bal, title,
        h('div.gold-widget.sticky.top-0.z-[50]', { id: 'gold-widget' }, [
          h('span.gw-gold', {}, [`${formatCredits(getCredits())} Credits`]),
          h('span.gw-sep', {}, ['·']),
          h('span.gw-slots', {}, [`${calcSpent()}g spent · ${draftBudget - calcSpent()}g left · ${calcSlots()}/6 slots`]),
        ]),
        h('p.text-white/60.text-sm',{},['Draft up to 6 units. Draft budget is fixed at 10 gold. Your wager is separate.']),
        betInput.el,
        h('div.grid.grid-cols-2.gap-2',{},[
          h('button.col-btn',{class: activeCollection === 'fantasy' ? 'col-btn active fantasy' : 'col-btn fantasy', onClick:()=>selectCollection('fantasy')},['⚔ Fantasy']),
          h('button.col-btn',{class: activeCollection === 'animals' ? 'col-btn active animals' : 'col-btn animals', onClick:()=>selectCollection('animals')},['🐾 Animals']),
        ]),
        renderWarfrontRewardLadder(DIFF_TABLE),
        h('div.gold-row',{},[
          h('span.lbl', {}, ['Gold']),
          h('span.val', {}, [`${draftBudget - calcSpent()}g`]),
          h('span.rem', {}, [`${calcSpent()}g spent · ${calcSlots()}/6 units`]),
        ]),
        renderWarfrontUnitGrid({ qty, budget: draftBudget, units: getWarfrontUnits(activeCollection), maxSlots: 6, onQtyChange: changeQty }),
        h('div.army-sticky', {}, [
          h('div.roster', {}, getDraftArmy().length ? getDraftArmy().map((id) => h('span.roster-chip', {}, [getUnitById(id)?.icon || '•'])) : [h('span.roster-empty', {}, ['No units selected yet'])]),
          h('button.btn-main',{onClick:doPlay,disabled:calcSlots()===0||loading},[loading ? 'Deploying…' : '⚔ Deploy Army']),
        ]),
        renderWarfrontHistoryWidget(historyRows),
      ]), { wide: true });
    }

    if (phase===PHASES.BATTLE) {
      return appShell(h('div.flex.flex-col.gap-4.p-4',{},[bal,title,battleStage()]), { wide: true });
    }

    if (phase===PHASES.RESULT) {
      const won = result?.won;
      const surrendered = !!result?.surrendered;
      const mult = result?.multiplier || 0;
      const payout = result?.payout || 0;
      const pHp = result?.playerBaseHp ?? 0;
      const eHp = result?.enemyBaseHp ?? 0;
      return appShell(h('div.flex.flex-col.gap-4.p-4',{},[
        bal, title,
        h('div.rounded-xl.border.p-4.text-center',{
          class: surrendered ? 'border-white/40 bg-white/5' : won ? 'border-accent-lime bg-accent-lime/10' : 'border-accent-rose bg-accent-rose/10',
        },[
          h('div.text-3xl.mb-2',{},[surrendered ? '🏳 Surrendered' : won ? '🏆 Victory!' : '💀 Defeat']),
          h('div.text-white/80',{},[`Player Base HP: ${pHp}  |  Enemy Base HP: ${eHp}`]),
          result?.enemyDifficulty ? h('div.text-white/60.text-sm.mt-1',{},[`Difficulty: ${result.enemyDifficulty}`]) : null,
          won ? h('div.text-accent-lime.font-bold.text-lg.mt-2',{},[`+${payout} credits (${mult.toFixed(2)}×)`]) : null,
        ]),
        h('div.flex.gap-2.mt-2',{},[
          h('button.btn.btn-ghost.w-1/2',{onClick:playAgain,disabled:loading},['Play Again']),
          h('button.btn.btn-accent.w-1/2',{onClick:draftAgain},['Draft Again']),
        ]),
        renderWarfrontHistoryWidget(historyRows),
      ]), { wide: true });
    }

    return appShell(h('div.p-4',{},['Unknown phase']), { wide: true });
  }

  return root;
}
