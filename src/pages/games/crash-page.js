/**
 * crash-page.js
 * Pre-commit cashout. Server resolves the crash point; we animate the curve
 * up to either the cashout or the actual crash point, whichever is lower.
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

  const canvas = h('canvas.w-full.h-48.rounded-xl.bg-white/[0.02].border.border-white/5', {
    width: 600,
    height: 192,
  });
  const ctx = canvas.getContext('2d');

  const launchBtn = h(
    'button.btn-primary.h-12.w-full.text-base',
    {
      onclick: async () => {
        const amount = bet.get();
        const err = validateBet(amount, userStore.get().profile?.credits);
        if (err) return toastError(err);

        launchBtn.disabled = true;
        display.textContent = '1.00×';
        display.className =
          'text-7xl font-mono font-bold text-accent-cyan h-32 flex items-center justify-center';

        let result;
        const promise = playCrash(amount, cashout)
          .then((r) => (result = r))
          .catch((e) => toastError(e.message));

        // Animate optimistically up to user's cashout. We'll cut short if
        // the server reveals an earlier crash.
        const startedAt = performance.now();
        let stopAt = timeForMultiplier(cashout); // seconds
        let crashed = false;

        const tick = () => {
          const t = (performance.now() - startedAt) / 1000;
          if (result) {
            stopAt = timeForMultiplier(Math.min(result.crashPoint, cashout));
            crashed = !result.won;
          }
          if (t >= stopAt) {
            const finalMult =
              result?.won
                ? cashout
                : result?.crashPoint ?? Math.min(cashout, multiplierAt(t));
            display.textContent = formatMultiplier(finalMult);
            display.className =
              'text-7xl font-mono font-bold h-32 flex items-center justify-center ' +
              (result?.won ? 'text-accent-lime' : 'text-accent-rose');
            if (result?.won)
              toastSuccess(`Cashed out at ${formatMultiplier(cashout)} · +${formatCredits(result.payout - amount)}`);
            else if (result) toastError(`Crashed at ${formatMultiplier(result.crashPoint)}`);
            patchProfile({ credits: result?.newBalance ?? userStore.get().profile?.credits });
            launchBtn.disabled = false;
            drawCurve(ctx, canvas, t, finalMult);
            return;
          }
          const m = multiplierAt(t);
          display.textContent = formatMultiplier(m);
          drawCurve(ctx, canvas, t, m);
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);

        await promise;
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
