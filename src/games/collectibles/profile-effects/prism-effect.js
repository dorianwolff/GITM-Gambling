import { h } from '../../../utils/dom.js';
import { backdropRoot, clamp, range, seeded } from './profile-effect-utils.js';

export function buildPrismBackdrop(summary) {
  const { visual, seed, intensity, count } = summary;
  const beamCount = clamp(6, Math.round(8 + intensity * 4 + count), 18);
  const beams = range(beamCount, (i) => {
    const angle = -32 + i * 7.5;
    const height = 36 + seeded(seed, i, 13) * 26;
    const delay = seeded(seed, i, 17) * 4;
    const duration = 6 + seeded(seed, i, 19) * 6;
    const left = -18 + seeded(seed, i, 23) * 72;
    return h('span.absolute.pointer-events-none.blur-2xl.mix-blend-screen', {
      style: {
        left: `${left}%`,
        top: `${8 + seeded(seed, i, 11) * 58}%`,
        width: '150%',
        height: `${height}%`,
        transform: `rotate(${angle}deg)`,
        background: `linear-gradient(90deg, transparent 0%, ${visual.accent}20 20%, ${visual.accent2}88 50%, ${visual.accent}24 78%, transparent 100%)`,
        opacity: 0.44 + seeded(seed, i, 29) * 0.32,
        animation: `collectible-prism-shift ${duration}s ease-in-out ${delay}s infinite`,
      },
    }, []);
  });

  const shards = range(18, (i) => {
    const x = seeded(seed, i, 31) * 100;
    const y = seeded(seed, i, 37) * 100;
    const size = 10 + seeded(seed, i, 41) * 34;
    const angle = -45 + seeded(seed, i, 43) * 90;
    const delay = seeded(seed, i, 47) * 4.5;
    const duration = 2.8 + seeded(seed, i, 53) * 3.4;
    return h('span.absolute.pointer-events-none.opacity-70', {
      style: {
        left: `${x}%`,
        top: `${y}%`,
        width: `${size}px`,
        height: `${size * 2.4}px`,
        '--prism-rot': `${angle}deg`,
        transform: `translate(-50%, -50%) rotate(${angle}deg)`,
        clipPath: 'polygon(50% 0%, 100% 35%, 82% 100%, 18% 100%, 0% 35%)',
        background: `linear-gradient(180deg, ${visual.accent}f0 0%, ${visual.accent2}aa 42%, rgba(255,255,255,0.18) 100%)`,
        boxShadow: `0 0 16px ${visual.accent}66`,
        animation: `collectible-prism-glint ${duration}s ease-in-out ${delay}s infinite`,
      },
    }, []);
  });

  return backdropRoot(summary, [
    h('div.absolute.inset-0', {
      style: {
        background: 'linear-gradient(135deg, rgba(8,8,18,0.88), rgba(18,8,26,0.82) 55%, rgba(6,8,20,0.9))',
        animation: 'collectible-prism-wave 10s ease-in-out infinite',
      },
    }, []),
    ...beams,
    ...shards,
  ]);
}
