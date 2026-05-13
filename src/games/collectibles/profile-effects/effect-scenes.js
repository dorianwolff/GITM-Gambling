import { getCollectibleVisual } from '../collectibles.js';

const PROFILE_EFFECT_SCENES = Object.freeze({
  bubble: {
    pageStyle: {
      background:
        'radial-gradient(circle at 50% 18%, rgba(122,217,255,0.20) 0%, transparent 24%), radial-gradient(circle at 20% 25%, rgba(176,107,255,0.14) 0%, transparent 18%), linear-gradient(180deg, rgba(2,20,38,0.94), rgba(4,10,24,0.98) 58%, rgba(3,14,32,0.96))',
    },
    heroStyle: {
      border: '1px solid rgba(122,217,255,0.34)',
      boxShadow: '0 0 24px rgba(122,217,255,0.16), inset 0 0 24px rgba(122,217,255,0.05)',
      background: 'linear-gradient(180deg, rgba(8,28,50,0.52), rgba(6,16,30,0.36))',
      backdropFilter: 'blur(18px) saturate(1.35)',
    },
    sectionStyle: {
      border: '1px solid rgba(122,217,255,0.26)',
      boxShadow: '0 0 18px rgba(122,217,255,0.12), inset 0 0 22px rgba(176,107,255,0.06)',
      background: 'linear-gradient(180deg, rgba(5,26,48,0.42), rgba(6,14,28,0.24))',
      backdropFilter: 'blur(12px) saturate(1.15)',
    },
    titleStyle: { textShadow: '0 0 18px rgba(122,217,255,0.45)' },
  },
  dragon: {
    pageStyle: {
      background:
        'radial-gradient(circle at 52% 12%, rgba(255,123,26,0.22) 0%, transparent 28%), radial-gradient(circle at 18% 18%, rgba(255,209,102,0.12) 0%, transparent 22%), linear-gradient(180deg, rgba(18,7,7,0.94), rgba(12,8,16,0.98) 48%, rgba(20,10,8,0.98))',
    },
    heroStyle: {
      border: '1px solid rgba(255,123,26,0.34)',
      boxShadow: '0 0 26px rgba(255,123,26,0.18), inset 0 0 30px rgba(255,209,102,0.06)',
      background: 'linear-gradient(180deg, rgba(55,16,7,0.50), rgba(24,9,8,0.34))',
      backdropFilter: 'blur(18px) saturate(1.15)',
    },
    sectionStyle: {
      border: '1px solid rgba(255,123,26,0.24)',
      boxShadow: '0 0 18px rgba(255,123,26,0.12), inset 0 0 20px rgba(255,209,102,0.04)',
      background: 'linear-gradient(180deg, rgba(46,16,8,0.34), rgba(18,7,8,0.26))',
      backdropFilter: 'blur(12px) saturate(1.08)',
    },
    titleStyle: { textShadow: '0 0 20px rgba(255,123,26,0.55)' },
  },
  cosmic: {
    pageStyle: {
      background:
        'radial-gradient(circle at 50% 12%, rgba(176,107,255,0.20) 0%, transparent 24%), radial-gradient(circle at 82% 20%, rgba(34,225,255,0.16) 0%, transparent 20%), linear-gradient(180deg, rgba(7,10,24,0.96), rgba(10,7,24,0.98) 60%, rgba(4,6,16,0.98))',
    },
    heroStyle: {
      border: '1px solid rgba(176,107,255,0.32)',
      boxShadow: '0 0 24px rgba(176,107,255,0.16), inset 0 0 22px rgba(34,225,255,0.05)',
      background: 'linear-gradient(180deg, rgba(11,10,30,0.54), rgba(8,8,20,0.34))',
      backdropFilter: 'blur(18px) saturate(1.18)',
    },
    sectionStyle: {
      border: '1px solid rgba(34,225,255,0.22)',
      boxShadow: '0 0 18px rgba(176,107,255,0.10), inset 0 0 20px rgba(34,225,255,0.04)',
      background: 'linear-gradient(180deg, rgba(10,10,28,0.38), rgba(6,8,18,0.24))',
      backdropFilter: 'blur(12px) saturate(1.08)',
    },
    titleStyle: { textShadow: '0 0 18px rgba(176,107,255,0.5)' },
  },
  prism: {
    pageStyle: {
      background:
        'radial-gradient(circle at 50% 12%, rgba(255,217,107,0.20) 0%, transparent 22%), radial-gradient(circle at 12% 18%, rgba(255,43,214,0.12) 0%, transparent 22%), linear-gradient(180deg, rgba(12,7,20,0.95), rgba(18,7,24,0.98) 58%, rgba(6,8,18,0.98))',
    },
    heroStyle: {
      border: '1px solid rgba(255,217,107,0.30)',
      boxShadow: '0 0 26px rgba(255,217,107,0.14), inset 0 0 22px rgba(255,43,214,0.04)',
      background: 'linear-gradient(180deg, rgba(28,10,28,0.50), rgba(16,8,20,0.32))',
      backdropFilter: 'blur(18px) saturate(1.25)',
    },
    sectionStyle: {
      border: '1px solid rgba(255,43,214,0.18)',
      boxShadow: '0 0 18px rgba(255,217,107,0.10), inset 0 0 20px rgba(255,43,214,0.04)',
      background: 'linear-gradient(180deg, rgba(22,10,26,0.38), rgba(8,8,18,0.24))',
      backdropFilter: 'blur(12px) saturate(1.08)',
    },
    titleStyle: { textShadow: '0 0 18px rgba(255,217,107,0.52)' },
  },
  spark: {
    pageStyle: {
      background:
        'radial-gradient(circle at 50% 12%, rgba(34,225,255,0.18) 0%, transparent 24%), radial-gradient(circle at 80% 18%, rgba(255,217,107,0.12) 0%, transparent 20%), linear-gradient(180deg, rgba(5,8,20,0.96), rgba(7,10,18,0.98) 60%, rgba(4,6,14,0.98))',
    },
    heroStyle: {
      border: '1px solid rgba(34,225,255,0.30)',
      boxShadow: '0 0 24px rgba(34,225,255,0.14), inset 0 0 20px rgba(255,217,107,0.04)',
      background: 'linear-gradient(180deg, rgba(10,18,28,0.48), rgba(8,12,20,0.32))',
      backdropFilter: 'blur(18px) saturate(1.18)',
    },
    sectionStyle: {
      border: '1px solid rgba(255,217,107,0.18)',
      boxShadow: '0 0 18px rgba(34,225,255,0.10), inset 0 0 20px rgba(255,217,107,0.04)',
      background: 'linear-gradient(180deg, rgba(10,14,20,0.38), rgba(6,8,14,0.24))',
      backdropFilter: 'blur(12px) saturate(1.08)',
    },
    titleStyle: { textShadow: '0 0 18px rgba(34,225,255,0.52)' },
  },
  ember: {
    pageStyle: {
      background:
        'radial-gradient(circle at 50% 12%, rgba(255,123,26,0.22) 0%, transparent 26%), radial-gradient(circle at 80% 18%, rgba(255,179,71,0.12) 0%, transparent 20%), linear-gradient(180deg, rgba(18,8,7,0.96), rgba(10,8,14,0.98) 60%, rgba(4,6,14,0.98))',
    },
    heroStyle: {
      border: '1px solid rgba(255,179,71,0.28)',
      boxShadow: '0 0 24px rgba(255,123,26,0.16), inset 0 0 20px rgba(255,179,71,0.05)',
      background: 'linear-gradient(180deg, rgba(30,12,8,0.48), rgba(16,8,10,0.32))',
      backdropFilter: 'blur(18px) saturate(1.14)',
    },
    sectionStyle: {
      border: '1px solid rgba(255,123,26,0.20)',
      boxShadow: '0 0 18px rgba(255,123,26,0.10), inset 0 0 20px rgba(255,179,71,0.04)',
      background: 'linear-gradient(180deg, rgba(22,10,10,0.38), rgba(8,8,14,0.24))',
      backdropFilter: 'blur(12px) saturate(1.08)',
    },
    titleStyle: { textShadow: '0 0 18px rgba(255,123,26,0.52)' },
  },
});

export function getProfileEffectScene(item) {
  if (!item) return null;
  const visual = getCollectibleVisual(item);
  const theme = visual.theme?.name;
  const preset = theme ? PROFILE_EFFECT_SCENES[theme] : null;
  if (!preset) return null;
  return {
    theme,
    visual,
    ...preset,
  };
}
