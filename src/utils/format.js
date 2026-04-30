/**
 * format.js
 * Formatters for display (credits, dates, percentages).
 */

const NF = new Intl.NumberFormat('en-US');
const NF_SIGN = new Intl.NumberFormat('en-US', { signDisplay: 'always' });

export function formatCredits(n) {
  if (n == null || Number.isNaN(n)) return '0';
  return NF.format(Math.trunc(n));
}

export function formatSignedCredits(n) {
  return NF_SIGN.format(Math.trunc(n));
}

export function formatMultiplier(x) {
  return `${(Math.round(x * 100) / 100).toFixed(2)}×`;
}

export function formatPct(x) {
  return `${(x * 100).toFixed(1)}%`;
}

const RTF = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const UNITS = [
  ['year', 60 * 60 * 24 * 365],
  ['month', 60 * 60 * 24 * 30],
  ['day', 60 * 60 * 24],
  ['hour', 60 * 60],
  ['minute', 60],
  ['second', 1],
];

export function timeAgo(dateLike) {
  const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
  const diffSec = (d.getTime() - Date.now()) / 1000;
  for (const [unit, secs] of UNITS) {
    if (Math.abs(diffSec) >= secs || unit === 'second') {
      return RTF.format(Math.round(diffSec / secs), unit);
    }
  }
  return '';
}

export function shortName(displayName, email) {
  if (displayName) return displayName;
  if (email) return email.split('@')[0];
  return 'Anonymous';
}

export function initials(displayName, email) {
  const src = shortName(displayName, email);
  return src
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('') || '?';
}
