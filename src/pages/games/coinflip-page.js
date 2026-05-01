/**
 * coinflip-page.js
 * Proper single-stroke coinflip animation.
 *
 * Flow (mirrors case-page.js):
 *   1. User clicks Flip. The coin begins a continuous rAF rotation
 *      immediately — no pause, no wait on the RPC.
 *   2. RPC fires in parallel. A minimum spin duration is enforced so the
 *      flip always reads even on instant responses.
 *   3. When the server returns, the coin computes a target rotation
 *      (whichever nearest multiple of 360° lands the correct face up)
 *      and eases out from its current angle + velocity to that angle.
 *   4. One continuous motion from click to landing. No snapping.
 */
import { h } from '../../utils/dom.js';
import { appShell } from '../../ui/layout/app-shell.js';
import { createBetInput } from '../../ui/components/bet-input.js';
import { playCoinflip } from '../../games/coinflip/coinflip-api.js';
import { userStore, patchProfile } from '../../state/user-store.js';
import { toastError, toastSuccess } from '../../ui/components/toast.js';
import { validateBet } from '../../utils/validation.js';
import { formatCredits } from '../../utils/format.js';
import { GAMES } from '../../config/constants.js';

const SPIN_VELOCITY_DEG = 1.6;   // deg/ms — ~580°/s, about 1.6 full spins/sec
const MIN_SPIN_MS       = 900;   // minimum pre-landing duration
const DECEL_MS          = 1500;  // deceleration-to-landing duration

export function renderCoinflip() {
  let side = 'heads';
  let busy = false;
  const bet = createBetInput({ value: 10, min: GAMES.COINFLIP.minBet });

  // ----- Coin DOM. 3D rotateY gives us a proper two-faced flip. -----
  const headsFace = h(
    'div.absolute.inset-0.rounded-full.flex.items-center.justify-center.text-6xl.font-bold.text-amber-900',
    {
      style: {
        background: 'radial-gradient(circle at 30% 30%, #ffe58a, #c08a13)',
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden',
        transform: 'rotateY(0deg)',
      },
    },
    ['H']
  );
  const tailsFace = h(
    'div.absolute.inset-0.rounded-full.flex.items-center.justify-center.text-6xl.font-bold.text-amber-900',
    {
      style: {
        background: 'radial-gradient(circle at 70% 30%, #ffe58a, #a06a0f)',
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden',
        transform: 'rotateY(180deg)',
      },
    },
    ['T']
  );
  const coinInner = h(
    'div.relative.w-48.h-48.rounded-full',
    {
      style: {
        transformStyle: 'preserve-3d',
        WebkitTransformStyle: 'preserve-3d',
        willChange: 'transform',
        transform: 'rotateY(0deg)',
        boxShadow: 'inset 0 0 30px rgba(0,0,0,0.4), 0 0 60px rgba(255,179,71,0.3)',
      },
    },
    [headsFace, tailsFace]
  );
  const coinWrap = h(
    'div.relative.w-48.h-48',
    {
      style: { perspective: '900px', WebkitPerspective: '900px' },
    },
    [coinInner]
  );

  // ----- Animation engine -----
  // phase: 'idle' | 'spin' | 'decel' | 'done'
  let phase = 'idle';
  let angle = 0;              // degrees — not normalised, keeps accumulating
  let lastT = 0;
  let rafId = null;
  let decelFrom = 0;
  let decelTarget = 0;
  let decelStart = 0;
  let landingResolve = null;

  function step(t) {
    if (!lastT) lastT = t;
    const dt = t - lastT;
    lastT = t;

    if (phase === 'spin') {
      angle += SPIN_VELOCITY_DEG * dt;
      coinInner.style.transform = `rotateY(${angle}deg)`;
      rafId = requestAnimationFrame(step);
    } else if (phase === 'decel') {
      const p = Math.min(1, (t - decelStart) / DECEL_MS);
      const eased = 1 - Math.pow(1 - p, 3);
      angle = decelFrom + (decelTarget - decelFrom) * eased;
      coinInner.style.transform = `rotateY(${angle}deg)`;
      if (p >= 1) {
        phase = 'done';
        rafId = null;
        angle = decelTarget;
        coinInner.style.transform = `rotateY(${angle}deg)`;
        landingResolve?.();
      } else {
        rafId = requestAnimationFrame(step);
      }
    }
  }

  function startSpin() {
    if (rafId != null) cancelAnimationFrame(rafId);
    phase = 'spin';
    lastT = 0;
    rafId = requestAnimationFrame(step);
  }

  /**
   * Decelerate from the current angle to the nearest multiple of 360°
   * (heads) or 360°+180° (tails) that also sits FURTHER AHEAD than the
   * current angle plus a generous "feel" buffer. Guarantees smooth motion
   * with no reversal.
   */
  function landOn(result) {
    // Velocity-based minimum extra angle: at least 2 full turns worth.
    const MIN_EXTRA = 720;
    const baseOffset = result === 'heads' ? 0 : 180;
    // angle may be any real number (we never normalise). Find the smallest
    // k such that 360*k + baseOffset > angle + MIN_EXTRA.
    const needed = angle + MIN_EXTRA - baseOffset;
    const k = Math.ceil(needed / 360);
    decelTarget = 360 * k + baseOffset;
    decelFrom = angle;
    decelStart = performance.now();
    phase = 'decel';
    return new Promise((resolve) => { landingResolve = resolve; });
  }

  function abortSpin() {
    if (rafId != null) cancelAnimationFrame(rafId);
    rafId = null;
    phase = 'idle';
    lastT = 0;
  }

  // ----- Result + log UI -----
  const resultEl = h('div.text-2xl.h-8.font-mono', {}, ['']);
  const log = h('div.flex.flex-col.gap-1.text-xs.text-muted.font-mono.max-h-40.overflow-auto', {}, []);

  const sideBtn = (s, label) =>
    h(`button.btn.h-12.flex-1.text-base`, {
      onclick: () => {
        if (busy) return;
        side = s;
        updateSideButtons();
      },
    }, [label]);
  const headsBtn = sideBtn('heads', '⬢ Heads');
  const tailsBtn = sideBtn('tails', '⬣ Tails');
  function updateSideButtons() {
    headsBtn.className = `btn h-12 flex-1 text-base ${side === 'heads' ? 'btn-primary' : 'btn-ghost'}`;
    tailsBtn.className = `btn h-12 flex-1 text-base ${side === 'tails' ? 'btn-primary' : 'btn-ghost'}`;
  }
  updateSideButtons();

  // ----- Flip button -----
  const flipBtn = h(
    'button.btn-primary.h-12.w-full.text-base',
    {
      onclick: async () => {
        if (busy) return;
        const amount = bet.get();
        const err = validateBet(amount, userStore.get().profile?.credits);
        if (err) return toastError(err);

        busy = true;
        flipBtn.disabled = true;
        resultEl.textContent = '';
        resultEl.className = 'text-2xl h-8 font-mono text-white/60';

        // Start spinning BEFORE the RPC so animation is already in motion.
        startSpin();

        let r;
        try {
          const rpcPromise = playCoinflip(amount, side);
          await sleep(MIN_SPIN_MS);
          r = await rpcPromise;
        } catch (e) {
          abortSpin();
          toastError(e.message ?? String(e));
          busy = false;
          flipBtn.disabled = false;
          return;
        }

        patchProfile({ credits: r.newBalance });

        // One continuous motion — decelerate onto the correct face.
        await landOn(r.result);

        if (r.won) {
          resultEl.textContent = `+${formatCredits(r.payout - amount)} cr · ${r.result.toUpperCase()}`;
          resultEl.className = 'text-2xl h-8 font-mono text-accent-lime font-bold';
          coinInner.animate(
            [{ boxShadow: 'inset 0 0 30px rgba(0,0,0,0.4), 0 0 60px rgba(255,179,71,0.3)' },
             { boxShadow: 'inset 0 0 30px rgba(0,0,0,0.4), 0 0 80px rgba(0,255,170,0.9)' },
             { boxShadow: 'inset 0 0 30px rgba(0,0,0,0.4), 0 0 60px rgba(255,179,71,0.3)' }],
            { duration: 900, easing: 'ease-out' }
          );
          toastSuccess(`Won ${formatCredits(r.payout)} cr`);
        } else {
          resultEl.textContent = `Lost ${formatCredits(amount)} · ${r.result.toUpperCase()}`;
          resultEl.className = 'text-2xl h-8 font-mono text-accent-rose font-bold';
        }

        log.prepend(
          h(`div.${r.won ? 'text-accent-lime' : 'text-accent-rose'}`, {}, [
            `${new Date().toLocaleTimeString()} · bet ${side} → ${r.result} · ${r.won ? '+' + (r.payout - amount) : '-' + amount}`,
          ])
        );

        busy = false;
        flipBtn.disabled = false;
      },
    },
    ['Flip']
  );

  const layout = h('div.grid.grid-cols-1.lg:grid-cols-2.gap-6', {}, [
    h('div.glass.neon-border.p-8.flex.flex-col.items-center.gap-6', {}, [
      coinWrap,
      resultEl,
    ]),
    h('div.glass.neon-border.p-6.flex.flex-col.gap-5', {}, [
      h('h2.text-xl.font-semibold', {}, ['Place your bet']),
      h('div.flex.gap-2', {}, [headsBtn, tailsBtn]),
      bet.el,
      flipBtn,
      h('div.text-xs.text-muted', {}, ['Payout 1.95× · Minimum bet 10 · House edge 2.5%']),
      h('h3.text-xs.text-muted.uppercase.tracking-widest.mt-2', {}, ['Your flips']),
      log,
    ]),
  ]);

  return appShell(
    h('div.flex.flex-col.gap-4', {}, [
      h('h1.text-3xl.font-semibold.heading-grad', {}, ['Coinflip']),
      layout,
    ])
  );
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
