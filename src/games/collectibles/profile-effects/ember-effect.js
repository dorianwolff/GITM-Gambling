import { h } from '../../../utils/dom.js';
import { backdropRoot, clamp, range, seeded } from './profile-effect-utils.js';

export function buildEmberBackdrop(summary) {
  const { visual, seed, intensity, count } = summary;
  const emberCount = clamp(14, Math.round(16 + count * 1.5 + intensity * 10), 36);
  const embers = range(emberCount, (i) => {
    const x = seeded(seed, i, 31) * 100;
    const size = 2 + Math.round(seeded(seed, i, 37) * 7);
    const duration = 4.4 + seeded(seed, i, 41) * 5.6;
    const delay = seeded(seed, i, 43) * 4.5;
    const sway = (seeded(seed, i, 47) - 0.5) * 36;

    return h('span.absolute.rounded-full.pointer-events-none', {
      style: {
        left: `${x}%`,
        bottom: `-${10 + seeded(seed, i, 53) * 20}%`,
        width: `${size}px`,
        height: `${size}px`,
        background: `radial-gradient(circle, rgba(255,255,255,0.95) 0%, ${visual.accent}ee 30%, ${visual.accent2}78 60%, transparent 82%)`,
        boxShadow: `0 0 14px ${visual.accent}88`,
        opacity: 0.28 + seeded(seed, i, 59) * 0.48,
        transform: `translateX(${sway}px)`,
        animation: `collectible-ember-rise ${duration}s linear ${delay}s infinite, collectible-ember-flicker ${2.8 + seeded(seed, i, 61) * 1.8}s ease-in-out ${delay}s infinite`,
      },
    }, []);
  });

  const flameBands = range(3, (i) => {
    const angle = -18 + i * 12;
    return h('span.absolute.left-[-16%].top-[10%].pointer-events-none.rounded-full.blur-3xl.mix-blend-screen', {
      style: {
        width: '132%',
        height: `${92 + i * 22}px`,
        background: `linear-gradient(90deg, transparent 0%, ${visual.accent}18 18%, ${visual.accent}92 50%, ${visual.accent2}a8 60%, transparent 100%)`,
        transform: `rotate(${angle}deg) translateY(${10 + i * 10}vh)`,
        animation: `collectible-ember-wave ${8.8 - i * 0.4}s ease-in-out ${i * 0.4}s infinite`,
        opacity: 0.54 + i * 0.08,
      },
    }, []);
  });

  return backdropRoot(summary, [
    h('div.absolute.inset-0', {
      style: {
        background: `radial-gradient(circle at 50% 42%, ${visual.accent}22 0%, transparent 38%), radial-gradient(circle at 50% 100%, ${visual.accent2}18 0%, transparent 40%)`,
        animation: 'collectible-ember-aura 9s ease-in-out infinite',
      },
    }, []),
    ...flameBands,
    ...embers,
  ]);
}
