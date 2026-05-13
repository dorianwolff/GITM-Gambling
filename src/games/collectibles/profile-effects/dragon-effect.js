import { h } from '../../../utils/dom.js';
import { backdropRoot, clamp, range, seeded } from './profile-effect-utils.js';

export function buildDragonBackdrop(summary) {
  const { visual, seed, intensity, count } = summary;
  const emberCount = clamp(28, Math.round(32 + count * 3 + intensity * 18), 72);
  const emberLayers = range(emberCount, (i) => {
    const x = seeded(seed, i, 3) * 100;
    const y = seeded(seed, i, 5) * 100;
    const size = 4 + Math.round(seeded(seed, i, 7) * 10);
    const delay = seeded(seed, i, 11) * 6;
    const duration = 4.8 + seeded(seed, i, 13) * 5.2;
    const drift = (seeded(seed, i, 17) - 0.5) * 18;

    return h('span.absolute.rounded-full.pointer-events-none', {
      style: {
        left: `${x}%`,
        top: `${y}%`,
        width: `${size}px`,
        height: `${size}px`,
        background: `radial-gradient(circle, rgba(255,255,255,0.95) 0%, ${visual.accent}dd 24%, ${visual.accent2}66 58%, transparent 78%)`,
        boxShadow: `0 0 10px ${visual.accent}aa, 0 0 24px ${visual.accent2}44`,
        opacity: 0.35 + seeded(seed, i, 19) * 0.55,
        transform: `translateX(${drift}px)`,
        animation: `collectible-dragon-ember ${duration}s linear ${delay}s infinite`,
      },
    }, []);
  });

  const ribbons = range(4, (i) => {
    const angle = -28 + i * 11;
    const wobble = 0.88 + i * 0.16;
    return h('span.absolute.left-[-20%].top-[14%].pointer-events-none.rounded-full.blur-3xl.mix-blend-screen', {
      style: {
        width: '140%',
        height: `${120 + i * 14}px`,
        background: `linear-gradient(90deg, transparent 0%, ${visual.accent}20 18%, ${visual.accent}86 45%, ${visual.accent2}f0 52%, ${visual.accent}88 62%, transparent 100%)`,
        '--dragon-angle': `${angle}deg`,
        transform: `rotate(${angle}deg) translateY(${i * 8}vh) scaleY(${wobble})`,
        opacity: 0.42 + i * 0.09,
        animation: `collectible-dragon-ribbon ${9.5 - i * 0.45}s ease-in-out ${i * 0.35}s infinite`,
      },
    }, []);
  });

  const wingLeft = h('span.absolute.left-[-8%].top-[18%].pointer-events-none.rounded-[45%_55%_40%_60%/35%_30%_70%_65%].blur-2xl.mix-blend-screen', {
    style: {
      width: '50%',
      height: '44%',
      background: `radial-gradient(circle at 75% 50%, ${visual.accent}d8 0%, ${visual.accent2}88 32%, transparent 70%)`,
      transformOrigin: '80% 50%',
      transform: 'rotate(-18deg)',
      opacity: 0.72,
      animation: 'collectible-dragon-wing 8.8s ease-in-out infinite',
      clipPath: 'polygon(0 48%, 24% 34%, 70% 0, 100% 25%, 84% 100%, 40% 82%, 14% 68%)',
    },
  }, []);

  const wingRight = h('span.absolute.right-[-8%].top-[18%].pointer-events-none.rounded-[55%_45%_60%_40%/30%_35%_65%_70%].blur-2xl.mix-blend-screen', {
    style: {
      width: '50%',
      height: '44%',
      background: `radial-gradient(circle at 25% 50%, ${visual.accent}d8 0%, ${visual.accent2}88 32%, transparent 70%)`,
      transformOrigin: '20% 50%',
      transform: 'rotate(18deg)',
      opacity: 0.72,
      animation: 'collectible-dragon-wing 8.8s ease-in-out infinite reverse',
      clipPath: 'polygon(100% 48%, 76% 34%, 30% 0, 0 25%, 16% 100%, 60% 82%, 86% 68%)',
    },
  }, []);

  const core = h('div.absolute.left-1/2.top-1/2.rounded-full.pointer-events-none.mix-blend-screen', {
    style: {
      width: '42vmin',
      height: '42vmin',
      transform: 'translate(-50%, -50%)',
      background: `radial-gradient(circle at 50% 50%, rgba(255,255,255,0.30) 0%, ${visual.accent2}42 18%, ${visual.accent}50 42%, rgba(0,0,0,0.18) 72%, transparent 100%)`,
      filter: 'blur(2px)',
      opacity: 0.95,
      animation: 'collectible-dragon-core 9s ease-in-out infinite',
      boxShadow: `0 0 60px ${visual.accent}55, 0 0 120px ${visual.accent2}33, inset 0 0 40px rgba(255,255,255,0.08)`,
    },
  }, []);

  return backdropRoot(summary, [
    h('div.absolute.inset-0', {
      style: {
        background: `radial-gradient(circle at 50% 48%, rgba(255,255,255,0.06) 0%, ${visual.accent}18 18%, transparent 46%), linear-gradient(135deg, rgba(7,8,16,0.96), rgba(18,8,10,0.72) 46%, rgba(26,10,5,0.62))`,
        animation: 'collectible-dragon-aura 10s ease-in-out infinite',
      },
    }, []),
    h('div.absolute.inset-0.opacity-75', {
      style: {
        background: 'radial-gradient(circle at 50% 50%, transparent 0%, rgba(0,0,0,0.18) 68%, rgba(0,0,0,0.42) 100%)',
        mixBlendMode: 'multiply',
      },
    }, []),
    wingLeft,
    wingRight,
    core,
    ...ribbons,
    ...emberLayers,
  ]);
}
