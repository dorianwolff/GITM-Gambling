/**
 * dice-page.js
 * Range-slider dice. Pick a target number and whether you're betting OVER
 * or UNDER it. The bar visualises the win/loss zones, the animated dice
 * cup spits out a number, and a tick-mark lands on the bar to show where
 * that roll fell.
 *
 * Minimum bet is computed per-multiplier so a winning roll is always
 * strictly profitable (mirrors the server check in v4 migration).
 */
import { h, mount } from '../../utils/dom.js';
import { appShell } from '../../ui/layout/app-shell.js';
import { createBetInput } from '../../ui/components/bet-input.js';
import { playDice, expectedMultiplier } from '../../games/dice/dice-api.js';
import { userStore, patchProfile } from '../../state/user-store.js';
import { toastError } from '../../ui/components/toast.js';
import { validateBet } from '../../utils/validation.js';
import { formatMultiplier, formatPct, formatCredits } from '../../utils/format.js';
import { GAMES } from '../../config/constants.js';

export function renderDice() {
  let target = 50;
  let over = true;
  let busy = false;
  let history = [];    // { roll, won, target, over, profit }

  const bet = createBetInput({ value: 10, min: GAMES.DICE.minBet });

  // ---------- Live-updating indicator elements ----------
  const multEl   = h('span.text-4xl.font-mono.font-bold.text-accent-cyan.leading-none', {}, []);
  const chanceEl = h('span.text-sm.text-muted.font-mono', {}, []);
  const targetEl = h('span.text-lg.font-mono.text-white', {}, []);
  const minBetEl = h('span.text-[10px].text-accent-amber.font-mono', {}, []);
  const profitEl = h('span.text-sm.text-accent-lime.font-mono', {}, []);

  // The live bar — a static wrapper + two dynamic zones + marker + roll tick.
  const loseZone = h('div.absolute.top-0.bottom-0.rounded-l-full', {
    style: { background: 'linear-gradient(90deg, rgba(255,0,80,0.7), rgba(255,0,80,0.25))' },
  }, []);
  const winZone = h('div.absolute.top-0.bottom-0.rounded-r-full', {
    style: { background: 'linear-gradient(270deg, rgba(0,255,170,0.7), rgba(0,255,170,0.25))' },
  }, []);
  const targetMarker = h('div.absolute.-top-3.-bottom-3.flex.flex-col.items-center', {
    style: { transform: 'translateX(-50%)' },
  }, [
    h('div.w-[3px].h-full.bg-white', {
      style: { boxShadow: '0 0 8px rgba(255,255,255,0.9)' },
    }, []),
    h('span.absolute.-bottom-6.font-mono.text-xs.text-white.font-bold', {}, [String(target)]),
  ]);
  const rollTick = h('div.absolute.w-0.h-0.transition-all.duration-300', {
    style: {
      top: '-14px',
      transform: 'translateX(-50%)',
      borderLeft: '8px solid transparent',
      borderRight: '8px solid transparent',
      borderTop: '14px solid transparent',
      opacity: '0',
    },
  }, []);

  const bar = h('div.relative.w-full.h-3.rounded-full', {
    style: {
      background: 'rgba(255,255,255,0.06)',
      border: '1px solid rgba(255,255,255,0.08)',
    },
  }, [loseZone, winZone, targetMarker, rollTick]);

  // Slider
  const slider = h('input.w-full', {
    type: 'range',
    min: '4',
    max: '96',
    value: String(target),
    style: { accentColor: '#22e1ff' },
  });
  slider.addEventListener('input', () => { target = Number(slider.value); refresh(); });

  // Mode buttons
  const overBtn = h('button.btn.flex-1.h-10', {
    onclick: () => { over = true; refresh(); }
  }, ['Roll OVER ▸']);
  const underBtn = h('button.btn.flex-1.h-10', {
    onclick: () => { over = false; refresh(); }
  }, ['◂ Roll UNDER']);

  // The dice result display
  const dieEl = h('div.relative.w-32.h-32.rounded-2xl.flex.items-center.justify-center', {
    style: {
      background: 'linear-gradient(145deg, #1a1e2a, #0a0d14)',
      border: '1px solid rgba(255,255,255,0.08)',
      boxShadow: 'inset 0 0 24px rgba(0,0,0,0.8), 0 0 30px rgba(34,225,255,0.15)',
      transition: 'box-shadow 0.3s, transform 0.1s',
    },
  }, [
    h('span.text-6xl.font-mono.font-bold.tabular-nums', { style: { color: '#fff' } }, ['—']),
  ]);

  const outcomeEl = h(
    'div.text-2xl.font-mono.h-8.transition-colors.font-bold',
    {},
    ['']
  );

  const historyEl = h('div.flex.gap-1.flex-wrap.justify-center.min-h-[28px]', {}, []);

  // ---------- update fn (only touches text/styles, no re-renders) ----------
  function refresh() {
    const winChance = over ? (100 - target) / 100 : (target - 1) / 100;
    const mult = winChance > 0 ? 0.97 / winChance : 0;
    const minForProfit = mult > 1 ? Math.max(GAMES.DICE.minBet, Math.ceil(1 / (mult - 1)) + 1) : Infinity;

    bet.setMin(Number.isFinite(minForProfit) ? minForProfit : GAMES.DICE.minBet);

    multEl.textContent   = formatMultiplier(mult);
    chanceEl.textContent = `${formatPct(winChance)} win chance`;
    targetEl.textContent = `${over ? '>' : '<'} ${target}`;
    targetMarker.style.left = `${target}%`;
    // text under marker
    const numLabel = targetMarker.querySelector('span');
    if (numLabel) numLabel.textContent = String(target);

    // Win / lose zone layout
    if (over) {
      loseZone.style.left = '0%';
      loseZone.style.right = `${100 - target}%`;
      winZone.style.left  = `${target}%`;
      winZone.style.right = '0%';
    } else {
      loseZone.style.left = `${target}%`;
      loseZone.style.right = '0%';
      winZone.style.left  = '0%';
      winZone.style.right = `${100 - target}%`;
    }

    // Profit preview (only visible if bet is valid)
    const amt = bet.get();
    const winPay = Math.floor(amt * mult);
    const profit = winPay - amt;
    profitEl.textContent = profit > 0
      ? `Win → +${formatCredits(profit)} cr (total ${formatCredits(winPay)})`
      : `Bet too small for this multiplier`;

    // Min-bet hint under the bet input
    if (Number.isFinite(minForProfit) && minForProfit > GAMES.DICE.minBet) {
      minBetEl.textContent = `Minimum at this multiplier: ${minForProfit} cr`;
    } else {
      minBetEl.textContent = `Minimum: ${GAMES.DICE.minBet} cr`;
    }

    // Mode-button styling
    overBtn.className  = `btn h-10 flex-1 ${ over ? 'btn-primary' : 'btn-ghost'}`;
    underBtn.className = `btn h-10 flex-1 ${!over ? 'btn-primary' : 'btn-ghost'}`;
  }
  refresh();

  // Re-run on bet input changes so the profit preview updates live.
  bet.el.addEventListener('input', () => {
    // Small deferred tick — createBetInput updates its internal `current`
    // synchronously, but we only need to refresh labels.
    queueMicrotask(refresh);
  });

  // ---------- roll! ----------
  const rollBtn = h('button.btn-primary.h-12.w-full.text-base', {
    onclick: async () => {
      if (busy) return;
      const amount = bet.get();
      const err = validateBet(amount, userStore.get().profile?.credits);
      if (err) return toastError(err);

      busy = true;
      rollBtn.disabled = true;
      outcomeEl.textContent = '';
      outcomeEl.className = 'text-2xl font-mono h-8 font-bold text-white/60';
      rollTick.style.opacity = '0';

      // Start the dice tumble animation: rapid-fire random numbers.
      const die = dieEl.firstElementChild;
      dieEl.style.transition = 'transform 80ms';
      const tumble = setInterval(() => {
        die.textContent = String(1 + Math.floor(Math.random() * 100));
        dieEl.style.transform = `rotate(${(Math.random() - 0.5) * 30}deg)`;
      }, 60);

      let result;
      try {
        result = await playDice(amount, target, over);
      } catch (e) {
        clearInterval(tumble);
        die.textContent = '—';
        dieEl.style.transform = 'rotate(0)';
        toastError(e.message);
        busy = false;
        rollBtn.disabled = false;
        return;
      }

      // Wait a touch so the animation reads, then land.
      await sleep(650);
      clearInterval(tumble);

      patchProfile({ credits: result.newBalance });

      die.textContent = String(result.roll);
      dieEl.style.transform = 'rotate(0)';
      dieEl.style.boxShadow = result.won
        ? 'inset 0 0 24px rgba(0,0,0,0.6), 0 0 40px rgba(0,255,170,0.7)'
        : 'inset 0 0 24px rgba(0,0,0,0.6), 0 0 40px rgba(255,0,80,0.7)';

      // Drop the tick onto the bar at the roll's position.
      rollTick.style.opacity = '1';
      rollTick.style.left = `${result.roll}%`;
      rollTick.style.borderTopColor = result.won ? '#00ffaa' : '#ff3370';

      outcomeEl.textContent = result.won
        ? `+${formatCredits(result.payout - amount)} cr · rolled ${result.roll}`
        : `Lost ${formatCredits(amount)} · rolled ${result.roll}`;
      outcomeEl.className =
        'text-2xl font-mono h-8 font-bold ' +
        (result.won ? 'text-accent-lime' : 'text-accent-rose');

      if (result.won) {
        dieEl.animate(
          [{ transform: 'scale(0.9)' }, { transform: 'scale(1.15)' }, { transform: 'scale(1)' }],
          { duration: 500, easing: 'cubic-bezier(.2,1.3,.5,1)' }
        );
      }

      history = [
        { roll: result.roll, won: result.won, target, over,
          profit: result.won ? result.payout - amount : -amount },
        ...history,
      ].slice(0, 16);
      renderHistory();

      // Reset dice glow after a beat.
      setTimeout(() => {
        dieEl.style.boxShadow =
          'inset 0 0 24px rgba(0,0,0,0.8), 0 0 30px rgba(34,225,255,0.15)';
      }, 1400);

      busy = false;
      rollBtn.disabled = false;
    },
  }, ['Roll dice']);

  function renderHistory() {
    mount(
      historyEl,
      h('div.flex.gap-1.flex-wrap.justify-center', {},
        history.map((h_) =>
          h(
            'span.inline-flex.items-center.justify-center.rounded-md.px-2.py-1.text-[11px].font-mono',
            {
              style: {
                background: h_.won ? 'rgba(0,255,170,0.12)' : 'rgba(255,0,80,0.12)',
                border: `1px solid ${h_.won ? 'rgba(0,255,170,0.35)' : 'rgba(255,0,80,0.35)'}`,
                color: h_.won ? '#00ffaa' : '#ff6d8a',
              },
            },
            [String(h_.roll)]
          )
        )
      )
    );
  }

  // ---------- layout ----------
  const leftPanel = h('div.glass.neon-border.p-8.flex.flex-col.items-center.gap-6', {}, [
    h('span.text-[10px].text-muted.uppercase.tracking-widest', {}, ['You rolled']),
    dieEl,
    outcomeEl,

    // The bar with win/lose zones, target marker and the drop tick.
    h('div.w-full.mt-4.px-3', {}, [
      h('div.relative.pt-1.pb-8', {}, [bar]),
      h('div.flex.justify-between.text-[10px].text-muted.font-mono.mt-2', {}, [
        h('span', {}, ['1']),
        h('span', {}, ['25']),
        h('span', {}, ['50']),
        h('span', {}, ['75']),
        h('span', {}, ['100']),
      ]),
    ]),

    h('div.text-[10px].text-muted.uppercase.tracking-widest.mt-4', {}, ['Last rolls']),
    historyEl,
  ]);

  const rightPanel = h('div.glass.neon-border.p-6.flex.flex-col.gap-5', {}, [
    // Stats row
    h('div.grid.grid-cols-3.gap-3.text-center', {}, [
      h('div.glass.p-3.flex.flex-col.gap-1', {}, [
        multEl,
        h('span.text-[10px].text-muted.uppercase.tracking-widest', {}, ['Multiplier']),
      ]),
      h('div.glass.p-3.flex.flex-col.gap-1.items-center', {}, [
        targetEl,
        h('span.text-[10px].text-muted.uppercase.tracking-widest', {}, ['Target']),
      ]),
      h('div.glass.p-3.flex.flex-col.gap-1.items-center', {}, [
        chanceEl,
        h('span.text-[10px].text-muted.uppercase.tracking-widest', {}, ['Chance']),
      ]),
    ]),

    // Mode
    h('div.flex.gap-2', {}, [underBtn, overBtn]),

    // Slider
    h('div.flex.flex-col.gap-2', {}, [
      h('label.text-xs.text-muted.uppercase.tracking-widest', {}, ['Target threshold (4–96)']),
      slider,
    ]),

    // Bet + min hint + preview
    h('div.flex.flex-col.gap-1', {}, [
      bet.el,
      minBetEl,
      profitEl,
    ]),

    rollBtn,

    h('div.text-xs.text-muted', {}, ['House edge 3% · Server-side RNG · Fair-play audited']),
  ]);

  return appShell(
    h('div.flex.flex-col.gap-4', {}, [
      h('h1.text-3xl.font-semibold.heading-grad', {}, ['Dice']),
      h('p.text-sm.text-muted', {}, [
        'Pick a target. The server rolls 1–100. If your bet lands in the green zone you win — multiplier scales with how risky your call was.',
      ]),
      h('div.grid.grid-cols-1.lg:grid-cols-2.gap-6', {}, [leftPanel, rightPanel]),
    ])
  );
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
