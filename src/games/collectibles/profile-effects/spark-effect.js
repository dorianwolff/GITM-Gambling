import { h } from '../../../utils/dom.js';
import { backdropRoot, clamp, range, seeded } from './profile-effect-utils.js';

export function buildSparkBackdrop(summary) {
  const { visual, seed, intensity, count } = summary;
  const sparkCount = clamp(20, Math.round(24 + count * 2 + intensity * 8), 48);
  const sparks = range(sparkCount, (i) => {
    const x = seeded(seed, i, 5) * 100;
    const y = seeded(seed, i, 7) * 100;
    const delay = seeded(seed, i, 11) * 4.5;
    const duration = 1.8 + seeded(seed, i, 13) * 2.8;
    const drift = (seeded(seed, i, 17) - 0.5) * 20;
    const size = 2 + Math.round(seeded(seed, i, 19) * 4);
    return h('span.absolute.pointer-events-none', {
      style: {
        left: `${x}%`,
        top: `${y}%`,
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '999px',
        background: `radial-gradient(circle, rgba(255,255,255,1) 0%, ${visual.accent}ee 35%, ${visual.accent2}88 62%, transparent 82%)`,
        boxShadow: `0 0 14px ${visual.accent}aa`,
        transform: `translateX(${drift}px)`,
        animation: `collectible-spark-twinkle ${duration}s ease-in-out ${delay}s infinite`,
      },
    }, []);
  });

  const streaks = range(5, (i) => {
    const left = 8 + seeded(seed, i, 23) * 84;
    const angle = -22 + i * 11;
    return h('span.absolute.pointer-events-none.rounded-full.blur-xl.mix-blend-screen', {
      style: {
        left: `${left}%`,
        top: `${12 + i * 14}%`,
        width: '40%',
        height: '6px',
        '--spark-angle': `${angle}deg`,
        background: `linear-gradient(90deg, transparent 0%, ${visual.accent}44 22%, ${visual.accent2}cc 52%, ${visual.accent}44 82%, transparent 100%)`,
        transform: `rotate(${angle}deg)`,
        opacity: 0.6,
        animation: `collectible-spark-streak ${6 + i * 0.4}s ease-in-out ${i * 0.25}s infinite`,
      },
    }, []);
  });

  return backdropRoot(summary, [
    h('div.absolute.inset-0', {
      style: {
        background: 'radial-gradient(circle at 50% 46%, rgba(255,255,255,0.08) 0%, transparent 34%), linear-gradient(135deg, rgba(8,11,22,0.82), rgba(7,7,14,0.95))',
        animation: 'collectible-spark-pulse 8s ease-in-out infinite',
      },
    }, []),
    ...streaks,
    ...sparks,
  ]);
}
