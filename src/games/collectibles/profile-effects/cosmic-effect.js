import { h } from '../../../utils/dom.js';
import { backdropRoot, clamp, range, seeded } from './profile-effect-utils.js';

export function buildCosmicBackdrop(summary) {
  const { visual, seed, intensity, count } = summary;
  const starCount = clamp(30, Math.round(34 + count * 3 + intensity * 12), 72);
  const stars = range(starCount, (i) => {
    const x = seeded(seed, i, 5) * 100;
    const y = seeded(seed, i, 9) * 100;
    const size = 1 + Math.round(seeded(seed, i, 13) * 3);
    const duration = 2.6 + seeded(seed, i, 17) * 4.2;
    const delay = seeded(seed, i, 19) * 5;

    return h('span.absolute.rounded-full.pointer-events-none', {
      style: {
        left: `${x}%`,
        top: `${y}%`,
        width: `${size}px`,
        height: `${size}px`,
        background: `radial-gradient(circle, rgba(255,255,255,0.98) 0%, ${visual.accent}dd 35%, transparent 74%)`,
        boxShadow: `0 0 10px ${visual.accent}99`,
        opacity: 0.3 + seeded(seed, i, 23) * 0.7,
        animation: `collectible-cosmic-twinkle ${duration}s ease-in-out ${delay}s infinite`,
      },
    }, []);
  });

  const rings = range(3, (i) => {
    const size = 34 + i * 14;
    return h('span.absolute.left-1/2.top-1/2.rounded-full.pointer-events-none.mix-blend-screen', {
      style: {
        width: `${size}vmin`,
        height: `${size}vmin`,
        transform: 'translate(-50%, -50%)',
        border: `1px solid ${i % 2 === 0 ? visual.accent : visual.accent2}55`,
        boxShadow: `0 0 24px ${visual.accent}18, inset 0 0 18px ${visual.accent2}14`,
        animation: `collectible-cosmic-orbit ${10 + i * 2.4}s linear ${i * 0.3}s infinite`,
      },
    }, []);
  });

  const nebulae = range(4, (i) => {
    const x = 10 + seeded(seed, i, 29) * 80;
    const y = 10 + seeded(seed, i, 31) * 70;
    const duration = 7 + seeded(seed, i, 37) * 5;
    return h('span.absolute.rounded-full.pointer-events-none.blur-3xl.mix-blend-screen', {
      style: {
        left: `${x}%`,
        top: `${y}%`,
        width: `${200 + i * 36}px`,
        height: `${180 + i * 28}px`,
        background: `radial-gradient(circle, ${visual.accent}30 0%, ${visual.accent2}16 38%, transparent 76%)`,
        opacity: 0.42,
        animation: `collectible-cosmic-drift ${duration}s ease-in-out ${i * 0.5}s infinite`,
      },
    }, []);
  });

  return backdropRoot(summary, [
    h('div.absolute.inset-0', {
      style: {
        background: 'linear-gradient(135deg, rgba(12,16,36,0.78), rgba(4,6,16,0.92))',
        animation: 'collectible-cosmic-pulse 12s ease-in-out infinite',
      },
    }, []),
    ...nebulae,
    ...rings,
    ...stars,
  ]);
}
