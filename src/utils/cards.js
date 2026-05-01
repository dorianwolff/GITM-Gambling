/**
 * cards.js
 * Standard 52-card deck helpers — used by every card game on this site.
 *
 * Encoding (mirrors supabase/schema.sql):
 *   card = 0..51
 *   rank = (card % 13) + 1   ⇒ 1=Ace, 2..10=pip, 11=J, 12=Q, 13=K
 *   suit = floor(card / 13)  ⇒ 0=♠ spades  1=♣ clubs  2=♥ hearts  3=♦ diamonds
 *
 * Suit color theme (per user spec):
 *   ♠ spades   → black
 *   ♣ clubs    → green
 *   ♥ hearts   → red
 *   ♦ diamonds → light blue
 */

// `color`       — used on the white card face (must be visible on white).
// `colorOnDark` — used in legends, score chips, anywhere we render a suit
//                 glyph or rank text on the app's dark UI surfaces. The
//                 spades black is invisible on the app background otherwise.
export const SUITS = [
  { idx: 0, glyph: '♠', name: 'spades',   color: '#0a0a0a', colorOnDark: '#e8ecf6', glow: 'rgba(255,255,255,0.10)' },
  { idx: 1, glyph: '♣', name: 'clubs',    color: '#1f8f4d', colorOnDark: '#3ddc7e', glow: 'rgba(61,220,126,0.40)' },
  { idx: 2, glyph: '♥', name: 'hearts',   color: '#cc1740', colorOnDark: '#ff3b6b', glow: 'rgba(255,59,107,0.40)' },
  { idx: 3, glyph: '♦', name: 'diamonds', color: '#1c7fbf', colorOnDark: '#7ad9ff', glow: 'rgba(122,217,255,0.45)' },
];

const RANK_LABELS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export function rankOf(card) {
  return (card % 13) + 1; // 1..13
}

export function suitOf(card) {
  return SUITS[Math.floor(card / 13) | 0];
}

export function rankLabel(card) {
  return RANK_LABELS[rankOf(card) - 1];
}

/** Blackjack value for a single card (Ace counts as 11; bust adjustment is per-hand). */
export function cardValue(card) {
  const r = rankOf(card);
  if (r === 1) return 11;
  if (r >= 10) return 10;
  return r;
}

/** Blackjack hand total with soft-ace handling. */
export function handTotal(cards) {
  let s = 0;
  let aces = 0;
  for (const c of cards) {
    const r = rankOf(c);
    if (r === 1) { aces += 1; s += 11; }
    else if (r >= 10) s += 10;
    else s += r;
  }
  while (s > 21 && aces > 0) { s -= 10; aces -= 1; }
  return s;
}

export function isSoft(cards) {
  let s = 0;
  let aces = 0;
  for (const c of cards) {
    const r = rankOf(c);
    if (r === 1) { aces += 1; s += 11; }
    else if (r >= 10) s += 10;
    else s += r;
  }
  // soft if any ace is still counted as 11 in the final total
  return aces > 0 && s <= 21;
}

export function isBlackjack(cards) {
  return cards.length === 2 && handTotal(cards) === 21;
}

export function sameRankForSplit(a, b) {
  const ra = rankOf(a);
  const rb = rankOf(b);
  return ra === rb || (ra >= 10 && rb >= 10);
}
