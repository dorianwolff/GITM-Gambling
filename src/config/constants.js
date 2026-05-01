/**
 * constants.js
 * Game balance, economy and feature flags. Keep all magic numbers here.
 * Server-side mirrors of these are in supabase/schema.sql — keep them in sync.
 */

export const ECONOMY = Object.freeze({
  DAILY_CREDITS: 100,
  STREAK_BONUS_PER_DAY: 10,
  STREAK_BONUS_CAP: 100,
  STARTING_CREDITS: 200,
});

export const LIMITS = Object.freeze({
  MIN_BET: 1,
  MAX_BET: 10_000,
  EVENTS_PER_DAY_PER_USER: 1,
  EVENT_TITLE_MIN: 6,
  EVENT_TITLE_MAX: 120,
  EVENT_DESC_MAX: 1000,
  EVENT_OPTIONS_MIN: 2,
  EVENT_OPTIONS_MAX: 8,
});

export const GAMES = Object.freeze({
  COINFLIP: { id: 'coinflip', name: 'Coinflip', payout: 1.95, minBet: 10 },
  DICE: { id: 'dice', name: 'Dice', housePayoutRtp: 0.97, minBet: 2 },
  ROULETTE: { id: 'roulette', name: 'Roulette' },
  BLACKJACK: { id: 'blackjack', name: 'Blackjack' },
  CRASH: { id: 'crash', name: 'Crash', maxMultiplier: 100 },
  EMOJI_HUNT: { id: 'emoji_hunt', name: 'Emoji Hunt', reward: 25 },
});

export const EMOJI_HUNT = Object.freeze({
  POOL: ['💎', '🪙', '🎰', '🍀', '⭐', '🔥', '🚀', '👑', '🦄', '🎲'],
  // Rough cadence; server is the actual source of truth.
  MIN_INTERVAL_MS: 60_000,
  MAX_INTERVAL_MS: 5 * 60_000,
  TTL_MS: 30_000,
});

export const ROUTES = Object.freeze({
  LOGIN: '/login',
  DASHBOARD: '/',
  EVENTS: '/events',
  EVENT_DETAIL: '/events/:id',
  CREATE_EVENT: '/events/new',
  GAMES: '/games',
  COINFLIP: '/games/coinflip',
  DICE: '/games/dice',
  ROULETTE: '/games/roulette',
  BLACKJACK: '/games/blackjack',
  CRASH: '/games/crash',
  EMOJI_HUNT: '/games/emoji-hunt',
  CASE: '/games/cases',
  LOBBY: '/games/lobby',
  MP_GAME: '/games/mp/:id',
  PROFILE: '/profile',
  PLAYER_PROFILE: '/players/:id',
  LEADERBOARD: '/leaderboard',
  HISTORY: '/history',
  MARKET: '/market',
  INVENTORY: '/market/inventory',
  LISTING_DETAIL: '/market/listing/:id',
  AUTH_CALLBACK: '/auth/callback',
});
