import { h } from '../../../utils/dom.js';

export function seeded(seed, index, salt = 0) {
  let x = (seed ^ Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return (x >>> 0) / 4294967295;
}

export function range(count, fn) {
  return Array.from({ length: count }, (_, i) => fn(i));
}

export function clamp(min, value, max) {
  return Math.max(min, Math.min(max, value));
}

export function backdropRoot(summary, children, extraStyle = {}) {
  const visual = summary.visual;
  return h('div.fixed.inset-0.pointer-events-none.z-0.overflow-hidden', {
    style: {
      background: `radial-gradient(circle at 50% 0%, ${visual.accent}18 0%, transparent 36%), radial-gradient(circle at 50% 100%, ${visual.accent2}14 0%, transparent 42%), linear-gradient(180deg, rgba(4,7,16,0.96), rgba(8,11,24,0.72))`,
      filter: `saturate(${1 + summary.intensity * 0.4})`,
      transform: 'translateZ(0)',
      willChange: 'transform, opacity, filter',
      ...extraStyle,
    },
  }, children);
}
