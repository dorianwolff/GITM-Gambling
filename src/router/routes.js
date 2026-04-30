/**
 * routes.js
 * Route table. Each entry pairs a path with the page render function and
 * applies the appropriate guard.
 */
import { ROUTES } from '../config/constants.js';
import { requireAuth, redirectIfAuthed } from '../auth/auth-guard.js';

import { renderLogin } from '../pages/login-page.js';
import { renderAuthCallback } from '../pages/auth-callback-page.js';
import { renderDashboard } from '../pages/dashboard-page.js';
import { renderEvents } from '../pages/events-page.js';
import { renderEventDetail } from '../pages/event-detail-page.js';
import { renderCreateEvent } from '../pages/create-event-page.js';
import { renderProfile } from '../pages/profile-page.js';
import { renderLeaderboard } from '../pages/leaderboard-page.js';
import { renderHistory } from '../pages/history-page.js';
import { renderGamesHub } from '../pages/games/games-hub-page.js';
import { renderCoinflip } from '../pages/games/coinflip-page.js';
import { renderDice } from '../pages/games/dice-page.js';
import { renderRoulette } from '../pages/games/roulette-page.js';
import { renderBlackjack } from '../pages/games/blackjack-page.js';
import { renderCrash } from '../pages/games/crash-page.js';
import { renderEmojiHunt } from '../pages/games/emoji-hunt-page.js';

export const routes = [
  { path: ROUTES.LOGIN, render: redirectIfAuthed(renderLogin) },
  { path: ROUTES.AUTH_CALLBACK, render: renderAuthCallback },

  { path: ROUTES.DASHBOARD, render: requireAuth(renderDashboard) },
  { path: ROUTES.EVENTS, render: requireAuth(renderEvents) },
  { path: ROUTES.CREATE_EVENT, render: requireAuth(renderCreateEvent) },
  { path: ROUTES.EVENT_DETAIL, render: requireAuth(renderEventDetail) },

  { path: ROUTES.GAMES, render: requireAuth(renderGamesHub) },
  { path: ROUTES.COINFLIP, render: requireAuth(renderCoinflip) },
  { path: ROUTES.DICE, render: requireAuth(renderDice) },
  { path: ROUTES.ROULETTE, render: requireAuth(renderRoulette) },
  { path: ROUTES.BLACKJACK, render: requireAuth(renderBlackjack) },
  { path: ROUTES.CRASH, render: requireAuth(renderCrash) },
  { path: ROUTES.EMOJI_HUNT, render: requireAuth(renderEmojiHunt) },

  { path: ROUTES.PROFILE, render: requireAuth(renderProfile) },
  { path: ROUTES.LEADERBOARD, render: requireAuth(renderLeaderboard) },
  { path: ROUTES.HISTORY, render: requireAuth(renderHistory) },
];
