/**
 * crash-page.js
 * Pre-commit cashout. The server resolves the crash point first; we then
 * animate the curve up to either the cashout (win) or the crash point
 * (loss). Doing the RPC BEFORE the animation eliminates the race that
 * used to make payouts silently disappear when the network round-trip
 * outlasted the animation.
 */
import { h } from '../../utils/dom.js';
import { appShell } from '../../ui/layout/app-shell.js';
import { createBetInput } from '../../ui/components/bet-input.js';
import { playCrash, multiplierAt, timeForMultiplier } from '../../games/crash/crash-api.js';
import { userStore, patchProfile } from '../../state/user-store.js';
import { toastError, toastSuccess } from '../../ui/components/toast.js';
import { validateBet } from '../../utils/validation.js';
import { formatCredits, formatMultiplier } from '../../utils/format.js';

export function renderCrash() {
  let cashout = 2.0;
  const bet = createBetInput({ value: 25 });

  const cashoutInput = h('input.input.text-center.font-mono.text-lg', {
    type: 'number',
    min: '1.01',
    max: '100',
    step: '0.01',
    value: cashout.toFixed(2),
  });
  cashoutInput.addEventListener('input', () => {
    cashout = Math.max(1.01, Math.min(100, Number(cashoutInput.value) || 2));
  });

  const display = h(
    'div.text-7xl.font-mono.font-bold.text-accent-cyan.h-32.flex.items-center.justify-center.transition-colors',
    {},
    ['1.00×']
  );

  const status = h(
    'div.h-5.text-xs.text-muted.text-center.font-mono',
    {},
    ['']
  );

  const canvas = h('canvas.w-full.h-48.rounded-xl.bg-white/[0.02].border.border-white/5', {
    width: 600,
    height: 192,
  });
  const ctx = canvas.getContext('2d');

  // Reset visuals to the idle state.
  function resetVisual() {
    display.textContent = '1.00×';
    display.className =
      'text-7xl font-mono font-bold text-accent-cyan h-32 flex items-center justify-center';
    status.textContent = '';
    drawCurve(ctx, canvas, 0, 1);
  }
  resetVisual();

  const launchBtn = h(
    'button.btn-primary.h-12.w-full.text-base',
    {
      onclick: async () => {
        const amount = bet.get();
        const err = validateBet(amount, userStore.get().profile?.credits);
        if (err) return toastError(err);

        // Snapshot the cashout target the user committed to. Even if they
        // edit the input mid-flight the round must use this value, since
        // it's what we sent to the server.
        const target = cashout;

        launchBtn.disabled = true;
        resetVisual();
        status.textContent = 'Launching…';

        // Resolve the round on the server FIRST. The animation comes
        // after, with full knowledge of the outcome — so a slow RPC
        // can never race the visual finish.
        let result;
        try {
          result = await playCrash(amount, target);
        } catch (e) {
          toastError(e.message);
          status.textContent = '';
          launchBtn.disabled = false;
          return;
        }

        // Force-patch the new balance immediately. Don't rely on realtime
        // to deliver — if the websocket is dead, we still want the UI to
        // reflect the authoritative payout the server just confirmed.
        patchProfile({ credits: result.newBalance });

        // Animate up to whichever multiplier landed: cashout (win) or
        // crashPoint (loss). The animation duration is determined by the
        // curve, so visually a 1.5× round finishes faster than a 5× one.
        const finalMult = result.won ? target : result.crashPoint;
        const stopAt = timeForMultiplier(finalMult);
        const startedAt = performance.now();
        status.textContent = result.won
          ? `Target ${formatMultiplier(target)} · cashing out…`
          : 'Climbing…';

        await new Promise((resolveAnim) => {
          const tick = () => {
            const t = (performance.now() - startedAt) / 1000;
            if (t >= stopAt) {
              display.textContent = formatMultiplier(finalMult);
              display.className =
                'text-7xl font-mono font-bold h-32 flex items-center justify-center ' +
                (result.won ? 'text-accent-lime' : 'text-accent-rose');
              drawCurve(ctx, canvas, t, finalMult);
              resolveAnim();
              return;
            }
            const m = multiplierAt(t);
            display.textContent = formatMultiplier(m);
            drawCurve(ctx, canvas, t, m);
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });

        // Settle the UI from authoritative result data.
        if (result.won) {
          const profit = result.payout - amount;
          status.textContent = `Cashed out at ${formatMultiplier(target)} · +${formatCredits(profit)} cr`;
          toastSuccess(`Cashed out · +${formatCredits(profit)} cr`);
        } else {
          status.textContent = `Crashed at ${formatMultiplier(result.crashPoint)} · -${formatCredits(amount)} cr`;
          toastError(`Crashed at ${formatMultiplier(result.crashPoint)}`);
        }

        // Re-patch in case any racing realtime event briefly overwrote.
        patchProfile({ credits: result.newBalance });
        launchBtn.disabled = false;
      },
    },
    ['Launch']
  );

  return appShell(
    h('div.flex.flex-col.gap-4', {}, [
      h('h1.text-3xl.font-semibold.heading-grad', {}, ['Crash']),
      h('p.text-sm.text-muted', {}, [
        'Pick a target multiplier. If the rocket reaches it, you win. If it crashes first, you lose.',
      ]),
      h('div.grid.grid-cols-1.lg:grid-cols-3.gap-4', {}, [
        h('div.lg:col-span-2.glass.neon-border.p-6.flex.flex-col.gap-4', {}, [
          display,
          status,
          canvas,
        ]),
        h('div.glass.neon-border.p-6.flex.flex-col.gap-4', {}, [
          h('div.flex.flex-col.gap-2', {}, [
            h('label.text-xs.text-muted.uppercase.tracking-widest', {}, ['Auto cashout (×)']),
            cashoutInput,
            h('div.flex.gap-2', {}, [1.5, 2, 3, 5, 10].map((v) =>
              h(
                'button.btn-ghost.h-9.flex-1.text-xs.font-mono',
                {
                  onclick: () => {
                    cashout = v;
                    cashoutInput.value = v.toFixed(2);
                  },
                },
                [v + '×']
              )
            )),
          ]),
          bet.el,
          launchBtn,
          h('div.text-xs.text-muted', {}, ['~96% RTP · 4% instabust']),
        ]),
      ]),
    ])
  );
}

function drawCurve(ctx, canvas, t, m) {
  const w = canvas.width;
  const hh = canvas.height;
  ctx.clearRect(0, 0, w, hh);

  // grid
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 8; i++) {
    ctx.beginPath();
    ctx.moveTo((w / 8) * i, 0);
    ctx.lineTo((w / 8) * i, hh);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, (hh / 4) * i);
    ctx.lineTo(w, (hh / 4) * i);
    ctx.stroke();
  }

  const grad = ctx.createLinearGradient(0, hh, w, 0);
  grad.addColorStop(0, '#22e1ff');
  grad.addColorStop(1, '#ff2bd6');
  ctx.strokeStyle = grad;
  ctx.lineWidth = 3;
  ctx.shadowColor = 'rgba(34,225,255,0.6)';
  ctx.shadowBlur = 12;

  ctx.beginPath();
  ctx.moveTo(0, hh);
  const steps = 80;
  const tMax = Math.max(t, 1);
  for (let i = 0; i <= steps; i++) {
    const tt = (i / steps) * tMax;
    const mm = multiplierAt(tt);
    const x = (i / steps) * w;
    const y = hh - Math.min(hh - 4, (Math.log(mm) / Math.log(m + 0.1)) * (hh - 8));
    ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
}
