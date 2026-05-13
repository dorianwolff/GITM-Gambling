import { h } from '../../../utils/dom.js';
import { backdropRoot, clamp, range, seeded } from './profile-effect-utils.js';

export function buildBubbleBackdrop(summary) {
  const { visual, seed, intensity, count } = summary;
  const bubbleCount = clamp(22, Math.round(24 + count * 2 + intensity * 14), 52);
  const bubbleLayers = range(bubbleCount, (i) => {
    const s = seeded(seed, i, 11);
    const left = 2 + (s * 96);
    const size = 8 + Math.round(seeded(seed, i, 29) * 42 * (0.55 + intensity));
    const drift = -10 + seeded(seed, i, 43) * 20;
    const duration = 8.5 + seeded(seed, i, 17) * 9.5;
    const delay = seeded(seed, i, 7) * 7;
    const wobble = 3.4 + seeded(seed, i, 53) * 2.6;
    const opacity = 0.22 + seeded(seed, i, 5) * 0.42;

    return h('span.absolute.rounded-full.pointer-events-none', {
      style: {
        left: `${left}%`,
        bottom: `-${10 + seeded(seed, i, 23) * 25}%`,
        width: `${size}px`,
        height: `${size}px`,
        border: '1px solid rgba(255,255,255,0.18)',
        background: `radial-gradient(circle at 28% 26%, rgba(255,255,255,0.98) 0%, ${visual.accent}a6 20%, ${visual.accent2}5a 54%, transparent 74%)`,
        boxShadow: `0 0 18px ${visual.accent}44, inset 0 0 14px rgba(255,255,255,0.20)`,
        opacity,
        transform: `translateX(${drift}vw)`,
        animation: `collectible-bubble-rise ${duration}s linear ${delay}s infinite, collectible-bubble-wobble ${wobble}s ease-in-out ${delay}s infinite`,
      },
    }, []);
  });

  const shafts = range(4, (i) => {
    const x = 12 + i * 24 + seeded(seed, i, 91) * 4;
    return h('span.absolute.top-[-10%].bottom-[-10%].pointer-events-none', {
      style: {
        left: `${x}%`,
        width: `${12 + i * 2}%`,
        background: 'linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(122,217,255,0.10) 18%, transparent 72%)',
        opacity: 0.28 + i * 0.06,
        filter: 'blur(10px)',
        animation: `collectible-bubble-shaft ${10 + i * 1.2}s ease-in-out ${i * 0.7}s infinite`,
      },
    }, []);
  });

  const caustic = h('span.absolute.inset-0.pointer-events-none.mix-blend-screen', {
    style: {
      background:
        'repeating-linear-gradient(115deg, rgba(255,255,255,0.00) 0 34px, rgba(122,217,255,0.06) 34px 54px, rgba(255,255,255,0.00) 54px 92px)',
      opacity: 0.42,
      transform: 'scale(1.06)',
      animation: 'collectible-bubble-caustic 14s linear infinite',
      filter: 'blur(1px)',
    },
  }, []);

  const giantBubbles = range(4, (i) => {
    const s = seeded(seed, i, 71);
    return h('span.absolute.rounded-full.pointer-events-none.blur-3xl.mix-blend-screen', {
      style: {
        left: `${12 + s * 72}%`,
        top: `${8 + seeded(seed, i, 73) * 78}%`,
        width: `${220 + i * 30}px`,
        height: `${220 + i * 28}px`,
        background: `radial-gradient(circle, ${visual.accent}38 0%, ${visual.accent2}18 38%, transparent 72%)`,
        animation: `collectible-bubble-pulse ${8 + i * 1.3}s ease-in-out ${i * 0.45}s infinite`,
        opacity: 0.65,
      },
    }, []);
  });

  return backdropRoot(summary, [
    h('div.absolute.inset-0', {
      style: {
        background:
          'radial-gradient(circle at 50% 20%, rgba(255,255,255,0.12) 0%, transparent 22%), radial-gradient(circle at 50% 42%, rgba(122,217,255,0.10) 0%, transparent 36%), linear-gradient(180deg, rgba(7,28,50,0.60), rgba(2,9,18,0.76))',
        mixBlendMode: 'screen',
        animation: 'collectible-bubble-sheen 10s ease-in-out infinite',
      },
    }, []),
    caustic,
    ...shafts,
    ...giantBubbles,
    ...bubbleLayers,
  ]);
}
