/**
 * routes.js
 * Route table. Each entry pairs a path with the page render function and
 * applies the appropriate guard.
 */
import { ROUTES } from '../config/constants.js';
import { requireAuth, redirectIfAuthed, requireActiveGame } from '../auth/auth-guard.js';

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
import { renderPlinko } from '../pages/games/plinko-page.js';
import { renderLottery } from '../pages/games/lottery-page.js';
import { renderEmojiHunt } from '../pages/games/emoji-hunt-page.js';
import { renderCase } from '../pages/games/case-page.js';
import { renderGacha } from '../pages/games/gacha-page.js';
import { renderMines } from '../pages/games/mines-page.js';
import { renderCandy } from '../pages/games/candy-page.js';
import { renderLobby } from '../pages/games/lobby-page.js';
import { renderMpTtt } from '../pages/games/mp-ttt-page.js';
import { renderPublicProfile } from '../pages/public-profile-page.js';
import { renderMarket } from '../pages/market-page.js';

export const routes = [
  { path: ROUTES.LOGIN, render: redirectIfAuthed(renderLogin) },
  { path: ROUTES.AUTH_CALLBACK, render: renderAuthCallback },

  { path: ROUTES.DASHBOARD, render: requireAuth(renderDashboard) },
  { path: ROUTES.EVENTS, render: requireAuth(renderEvents) },
  { path: ROUTES.CREATE_EVENT, render: requireAuth(renderCreateEvent) },
  { path: ROUTES.EVENT_DETAIL, render: requireAuth(renderEventDetail) },

  // Hub + always-on routes (emoji hunt is meta, not in rotation; multiplayer
  // is online-only). Rotated games go through `requireActiveGame`, which
  // hard-replaces the URL to /games when the game isn't currently in the
  // 6-game rotation, so even Back can't reopen it.
  { path: ROUTES.GAMES, render: requireAuth(renderGamesHub) },
  { path: ROUTES.COINFLIP,  render: requireActiveGame('coinflip',  renderCoinflip) },
  { path: ROUTES.DICE,      render: requireActiveGame('dice',      renderDice) },
  { path: ROUTES.ROULETTE,  render: requireActiveGame('roulette',  renderRoulette) },
  { path: ROUTES.BLACKJACK, render: requireActiveGame('blackjack', renderBlackjack) },
  { path: ROUTES.CRASH,     render: requireActiveGame('crash',     renderCrash) },
  { path: ROUTES.CASE,      render: requireActiveGame('cases',     renderCase) },
  { path: ROUTES.GACHA,     render: requireActiveGame('gacha',     renderGacha) },
  { path: ROUTES.MINES,     render: requireActiveGame('mines',     renderMines) },
  { path: ROUTES.CANDY,     render: requireActiveGame('candy',     renderCandy) },
  { path: ROUTES.PLINKO,    render: requireActiveGame('plinko',    renderPlinko) },
  { path: ROUTES.LOTTERY,   render: requireActiveGame('lottery',   renderLottery) },
  { path: ROUTES.EMOJI_HUNT, render: requireAuth(renderEmojiHunt) },
  { path: ROUTES.LOBBY,     render: requireAuth(renderLobby) },
  { path: ROUTES.MP_GAME,   render: requireAuth(renderMpTtt) },

  { path: ROUTES.PROFILE, render: requireAuth(renderProfile) },
  { path: ROUTES.PLAYER_PROFILE, render: requireAuth(renderPublicProfile) },
  { path: ROUTES.LEADERBOARD, render: requireAuth(renderLeaderboard) },
  { path: ROUTES.HISTORY, render: requireAuth(renderHistory) },
  { path: ROUTES.MARKET, render: requireAuth(renderMarket) },
];
