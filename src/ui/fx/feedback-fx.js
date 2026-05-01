/**
 * feedback-fx.js
 * Reusable full-screen feedback effects for win/loss/bonus moments.
 *
 * Every game funnels its outcome through one of these helpers so the dopamine
 * vocabulary stays consistent across the whole site:
 *
 *   flashSuccess()       — light green wash + soft chime motion
 *   flashSuccessMajor()  — heavy green wash + confetti burst + glow ring
 *   flashLoss()          — light red wash + brief shake
 *   flashLossMajor()     — heavy red wash + heavy shake + dimmer
 *   flashGold()          — gold radial pop + sparkles (21s, jackpots, BJ)
 *   flashGoldSubtle()    — small gold pulse (20s, near-miss bonuses)
 *   flashStreakText(txt) — large center-screen "JACKPOT" / "BUSTED" text
 *
 * All effects are non-blocking (auto-cleanup), purely visual, and respect
 * `prefers-reduced-motion` by short-circuiting to a 1-frame flash.
 */

const HOST_ID = 'gitm-fx-host';
const STYLE_ID = 'gitm-fx-styles';

const reducedMotion =
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function ensureHost() {
  if (typeof document === 'undefined') return null;
  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = HOST_ID;
    Object.assign(host.style, {
      position: 'fixed',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '90',
      overflow: 'hidden',
    });
    document.body.appendChild(host);
  }
  if (!document.getElementById(STYLE_ID)) {
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = STYLES;
    document.head.appendChild(s);
  }
  return host;
}

const STYLES = `
@keyframes gitm-fx-fade-out {
  from { opacity: var(--fx-peak, 1); }
  to   { opacity: 0; }
}
@keyframes gitm-fx-fade-in-out {
  0%   { opacity: 0; }
  18%  { opacity: var(--fx-peak, 1); }
  100% { opacity: 0; }
}
@keyframes gitm-fx-pop {
  0%   { transform: translate(-50%, -50%) scale(0.4); opacity: 0; filter: blur(8px); }
  35%  { transform: translate(-50%, -50%) scale(1.15); opacity: 1; filter: blur(0); }
  60%  { transform: translate(-50%, -50%) scale(1);    opacity: 1; }
  100% { transform: translate(-50%, -50%) scale(1.4);  opacity: 0; }
}
@keyframes gitm-fx-shake {
  0%,100%       { transform: translate3d(0,0,0); }
  10%,30%,50%,70%,90% { transform: translate3d(-6px,0,0); }
  20%,40%,60%,80%     { transform: translate3d( 6px,0,0); }
}
@keyframes gitm-fx-shake-heavy {
  0%,100%       { transform: translate3d(0,0,0); }
  10%           { transform: translate3d(-12px,-4px,0); }
  20%           { transform: translate3d( 12px, 6px,0); }
  30%           { transform: translate3d(-14px, 2px,0); }
  40%           { transform: translate3d( 10px,-6px,0); }
  50%           { transform: translate3d(-10px, 4px,0); }
  60%           { transform: translate3d(  8px,-2px,0); }
  70%           { transform: translate3d( -8px, 6px,0); }
  80%           { transform: translate3d(  6px,-2px,0); }
  90%           { transform: translate3d( -4px, 0,  0); }
}
@keyframes gitm-fx-confetti-fall {
  0%   { transform: translate3d(0, -10vh, 0) rotate(0deg);   opacity: 1; }
  85%  { opacity: 1; }
  100% { transform: translate3d(var(--fx-dx, 0), 110vh, 0) rotate(720deg); opacity: 0; }
}
@keyframes gitm-fx-spark {
  0%   { transform: translate(-50%,-50%) scale(0);   opacity: 1; }
  60%  { transform: translate(calc(-50% + var(--fx-dx, 0)), calc(-50% + var(--fx-dy, 0))) scale(1); opacity: 1; }
  100% { transform: translate(calc(-50% + var(--fx-dx, 0)), calc(-50% + var(--fx-dy, 0))) scale(0.2); opacity: 0; }
}

.gitm-fx-shake-target { animation: gitm-fx-shake 0.55s cubic-bezier(.36,.07,.19,.97) both; }
.gitm-fx-shake-heavy-target { animation: gitm-fx-shake-heavy 0.9s cubic-bezier(.36,.07,.19,.97) both; }
`;

/* ---------- low-level primitives ---------- */

function washLayer({ gradient, peak = 1, duration = 900 }) {
  const host = ensureHost();
  if (!host) return;
  const el = document.createElement('div');
  Object.assign(el.style, {
    position: 'absolute',
    inset: '0',
    background: gradient,
    mixBlendMode: 'screen',
    opacity: '0',
    willChange: 'opacity',
  });
  el.style.setProperty('--fx-peak', String(peak));
  el.style.animation = `gitm-fx-fade-in-out ${duration}ms cubic-bezier(0.2,0.8,0.2,1) forwards`;
  host.appendChild(el);
  setTimeout(() => el.remove(), duration + 60);
}

function centerPop({ text, color = '#22e1ff', size = '8rem', duration = 1100, weight = 900 }) {
  const host = ensureHost();
  if (!host) return;
  const el = document.createElement('div');
  Object.assign(el.style, {
    position: 'absolute',
    left: '50%',
    top: '50%',
    transform: 'translate(-50%,-50%) scale(0.4)',
    fontSize: size,
    fontWeight: String(weight),
    letterSpacing: '0.06em',
    color,
    textShadow: `0 0 32px ${color}, 0 6px 24px rgba(0,0,0,0.7)`,
    fontFamily: 'system-ui, sans-serif',
    pointerEvents: 'none',
    whiteSpace: 'nowrap',
  });
  el.textContent = text;
  el.style.animation = `gitm-fx-pop ${duration}ms cubic-bezier(0.2,1.2,0.4,1) forwards`;
  host.appendChild(el);
  setTimeout(() => el.remove(), duration + 60);
}

function confettiBurst({ colors = ['#22e1ff', '#8b5cf6', '#ff2bd6', '#3ddc7e', '#ffd166'], count = 70, duration = 2200 }) {
  const host = ensureHost();
  if (!host) return;
  for (let i = 0; i < count; i++) {
    const piece = document.createElement('div');
    const size = 6 + Math.random() * 8;
    Object.assign(piece.style, {
      position: 'absolute',
      left: `${Math.random() * 100}%`,
      top: '0',
      width: `${size}px`,
      height: `${size * 0.4}px`,
      background: colors[i % colors.length],
      borderRadius: Math.random() > 0.5 ? '2px' : '50%',
      transform: 'translate3d(0, -10vh, 0)',
      opacity: '0',
      willChange: 'transform, opacity',
    });
    const dx = (Math.random() - 0.5) * 240;
    piece.style.setProperty('--fx-dx', `${dx}px`);
    const delay = Math.random() * 200;
    piece.style.animation = `gitm-fx-confetti-fall ${duration}ms cubic-bezier(0.2,0.4,0.4,1) ${delay}ms forwards`;
    host.appendChild(piece);
    setTimeout(() => piece.remove(), duration + delay + 60);
  }
}

function sparkBurst({ color = '#ffd166', count = 18, duration = 800 }) {
  const host = ensureHost();
  if (!host) return;
  for (let i = 0; i < count; i++) {
    const s = document.createElement('div');
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
    const dist = 120 + Math.random() * 90;
    Object.assign(s.style, {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: '8px',
      height: '8px',
      borderRadius: '50%',
      background: color,
      boxShadow: `0 0 14px ${color}`,
      transform: 'translate(-50%,-50%) scale(0)',
      willChange: 'transform, opacity',
    });
    s.style.setProperty('--fx-dx', `${Math.cos(angle) * dist}px`);
    s.style.setProperty('--fx-dy', `${Math.sin(angle) * dist}px`);
    s.style.animation = `gitm-fx-spark ${duration}ms cubic-bezier(0.2,0.7,0.4,1) forwards`;
    host.appendChild(s);
    setTimeout(() => s.remove(), duration + 60);
  }
}

function shake(target = document.getElementById('app'), heavy = false) {
  if (!target) return;
  const cls = heavy ? 'gitm-fx-shake-heavy-target' : 'gitm-fx-shake-target';
  target.classList.remove(cls);
  // force reflow so re-adding restarts the animation
  void target.offsetWidth;
  target.classList.add(cls);
  setTimeout(() => target.classList.remove(cls), heavy ? 950 : 600);
}

/* ---------- public API ---------- */

export function flashSuccess() {
  if (reducedMotion) return washLayer({ gradient: 'rgba(61,220,126,0.18)', duration: 250 });
  washLayer({
    gradient:
      'radial-gradient(ellipse at center, rgba(61,220,126,0.28) 0%, rgba(61,220,126,0.10) 45%, transparent 75%)',
    peak: 1,
    duration: 900,
  });
}

export function flashSuccessMajor({ label = null } = {}) {
  if (reducedMotion) return washLayer({ gradient: 'rgba(61,220,126,0.30)', duration: 280 });
  washLayer({
    gradient:
      'radial-gradient(ellipse at center, rgba(61,220,126,0.55) 0%, rgba(34,225,255,0.25) 40%, transparent 80%)',
    peak: 1,
    duration: 1200,
  });
  confettiBurst({ count: 90, duration: 2400 });
  if (label) centerPop({ text: label, color: '#3ddc7e', size: '7rem' });
}

export function flashLoss() {
  if (reducedMotion) return washLayer({ gradient: 'rgba(255,59,107,0.16)', duration: 250 });
  washLayer({
    gradient:
      'radial-gradient(ellipse at center, rgba(255,59,107,0.28) 0%, rgba(255,59,107,0.08) 50%, transparent 78%)',
    peak: 1,
    duration: 800,
  });
  shake(document.getElementById('app'), false);
}

export function flashLossMajor({ label = null, intense = false } = {}) {
  if (reducedMotion) return washLayer({ gradient: 'rgba(255,59,107,0.40)', duration: 320 });
  washLayer({
    gradient: intense
      ? 'radial-gradient(ellipse at center, rgba(255,59,107,0.85) 0%, rgba(180,0,30,0.55) 40%, rgba(0,0,0,0.30) 80%)'
      : 'radial-gradient(ellipse at center, rgba(255,59,107,0.65) 0%, rgba(180,0,30,0.30) 50%, transparent 85%)',
    peak: 1,
    duration: intense ? 1500 : 1200,
  });
  shake(document.getElementById('app'), true);
  if (label) centerPop({ text: label, color: '#ff3b6b', size: '7rem' });
}

export function flashGold({ label = null } = {}) {
  if (reducedMotion) return washLayer({ gradient: 'rgba(255,209,102,0.30)', duration: 300 });
  washLayer({
    gradient:
      'radial-gradient(ellipse at center, rgba(255,209,102,0.55) 0%, rgba(255,160,40,0.25) 45%, transparent 80%)',
    peak: 1,
    duration: 1300,
  });
  sparkBurst({ color: '#ffd166', count: 22, duration: 1000 });
  confettiBurst({
    colors: ['#ffd166', '#ffb347', '#ffe66d', '#22e1ff'],
    count: 60,
    duration: 2000,
  });
  if (label) centerPop({ text: label, color: '#ffd166', size: '7.5rem' });
}

export function flashGoldSubtle({ label = null } = {}) {
  if (reducedMotion) return;
  washLayer({
    gradient:
      'radial-gradient(ellipse at center, rgba(255,209,102,0.25) 0%, transparent 70%)',
    peak: 1,
    duration: 700,
  });
  sparkBurst({ color: '#ffd166', count: 10, duration: 700 });
  if (label) centerPop({ text: label, color: '#ffd166', size: '4.5rem', duration: 900 });
}

export function flashStreakText(text, color = '#22e1ff') {
  if (reducedMotion) return;
  centerPop({ text, color, size: '7rem' });
}

export const fx = {
  flashSuccess,
  flashSuccessMajor,
  flashLoss,
  flashLossMajor,
  flashGold,
  flashGoldSubtle,
  flashStreakText,
};
