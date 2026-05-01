# GITM — social credit gambling

A modern, real-time, **no-money-involved** gambling site for EPITA. Sign in
with your Microsoft school account, get a free daily credit drop, then bet
on student-created events, play mini-games, or hunt emojis hidden across
the site.

> Heavily inspired by https://www.sigambling.fr — same spirit, different stack.

![stack](https://img.shields.io/badge/stack-Vite_+_Vanilla_JS_+_Tailwind_+_Supabase-22e1ff?style=flat-square)

## Features

- 🪪 **Microsoft school login only** — single-tenant Azure AD via Supabase
  OAuth. Server-side email-domain allow-list is enforced too (defense in
  depth).
- 💰 **Daily credits** — 100 base + up to 100 streak bonus.
- 🎯 **Custom events** — any student creates a betting event (1/day,
  admins unlimited). Pari-mutuel pool with no house fee (fully
  redistributed). Realtime updates to all viewers.
- 🪙🎲🎡🃏🚀💣🍭🎰🎮🔴🎱 **Eleven mini-games** — all server-resolved, the client
  cannot cheat. Six are active at any moment on a rotating schedule:
  - **Coinflip** — pick heads or tails, 1.95× payout.
  - **Dice** — roll over/under a target with dynamic multiplier.
  - **Roulette** — European-style with server-spin.
  - **Blackjack** — full interactive table: hit, stand, double, split,
    surrender, and insurance. Multi-hand support after splits.
  - **Crash** — watch the multiplier climb, cash out before it crashes.
  - **Plinko** — drop a ball through a peg board (8–12 rows, low/medium/high risk) and land in multiplier slots. Pure RNG with escalating edge payouts.
  - **Neon Lotto** — pick 5 numbers from 1-36. Watch 5 numbered balls tumble out one by one. Match 2+ for payouts up to 8,000×. ~97% RTP.
  - **Cases** — lootbox tiers (Bronze / Silver / Gold) with seven
    rarities from Common to Ultra. Golden keys remove commons, pity
    guarantees a Rare after ten consecutive duds, batch open up to 50 at
    once, and a small chance to drop a cosmetic item.
  - **Minesweeper** — 5×5 grid, choose 1–24 mines. Reveal safe tiles to
    climb the multiplier, cash out anytime, or hit a mine and bust.
  - **Candy Crush** — 6×6 match-3 cascade resolver. Up to 8 rounds of
    gravity + refills with tiered payouts per cleared cluster.
  - **Gacha Wheel** — 1 or 10 pulls for cosmetics. Rarities from Common
    up to Mythic and genuine **One-of-One** trophies. Pity forces
    Legendary+ on the 80th pull. One-of-one slots are consumed forever
    once claimed.
- 🎮 **Multiplayer Tic-Tac-Toe** — two variants with credit antes:
  - **Chaos** — after every move a random event fires (blocked cell,
    piece removal, or swap). The previously locked cell unlocks
    immediately.
  - **Fade** — each player may only have 3 pieces on the board. Placing a
    4th fades the oldest piece. Winner takes the whole pot (no house fee).
- 🛒 **Market & Auctions** — shop and player-driven economy for
  cosmetics (badges, frames, titles, effects, trophies). List items for
  timed auction (1–48 h), bid with escrowed funds, tiered seller fee
  (12 % down to 2 %), and anti-sniping extension (last 2 min extends by
  2 min). Equip cosmetics to show off on your profile.
- 👀 **Emoji hunts** — auto-spawned across the site at a client-driven
  cadence. First click wins, resolved atomically in Postgres. Spawns
  only land on pages that are currently reachable (respecting the active
  game rotation).
- 🏆 **Six live leaderboards** — Credits, Peak Credits, Biggest Single
  Win, Total Won, Total Wagered, Cases Opened, and Collection (unique
  items owned). All backed by denormalised profile columns with real-time
  triggers, capped at 100 entries each.
- 👑 **King of the Hill achievements** — hold #1 on any leaderboard for
  one continuous hour to unlock a permanent badge and a 5 000 credit
  reward. Once per board, per user.
- 🌌 **Modern UI** — glass cards, neon gradients, futuristic vibe (no
  table-skin casino kitsch).

## Architecture

```
┌──────────────────────┐         ┌──────────────────────────┐
│ Browser (Vite SPA)   │ ◀────▶  │ Supabase                 │
│  · vanilla JS        │  PKCE   │  · Postgres (RLS)        │
│  · Tailwind          │  realtime  · Auth (Azure OAuth)   │
│  · tiny pub/sub store│         │  · SECURITY DEFINER RPCs │
└──────────────────────┘         └──────────────────────────┘
                                            ▲
                                            │ OAuth
                                            ▼
                                  ┌──────────────────┐
                                  │ Microsoft Entra  │
                                  │   (single tenant)│
                                  └──────────────────┘
```

**Security model**: the browser only ever holds the public Supabase
**anon** key. All credit-affecting writes go through SECURITY DEFINER
Postgres functions (`play_coinflip`, `play_dice`, `play_roulette`,
`bj_start`, `bj_hit`, `bj_stand`, `bj_double`, `bj_split`, `bj_surrender`,
`bj_insurance`, `play_crash`, `open_case`, `open_case_batch`, `gacha_pull`,
`minesweeper_start`, `minesweeper_reveal`, `minesweeper_cashout`,
`candy_spin`, `mp_create_game`, `mp_join_game`, `mp_make_move`,
`mp_resign`, `mp_cancel_game`, `market_buy`, `market_list`, `market_bid`,
`market_cancel`, `market_settle`, `place_event_bet`, `resolve_event`,
`claim_daily_credits`, `claim_emoji_hunt`). The `credits` column of
`profiles` is **not writable** from the client — RLS denies any update
that would change it. All randomness for credit-affecting outcomes lives
in Postgres.

## Quick start

```bash
cp .env.example .env.local      # fill in 3 values
npm install
npm run dev
```

Then read **[SETUP.md](./SETUP.md)** for the full Supabase + Azure walk-through.

## Project layout

```
src/
├── auth/            ← Microsoft OAuth, session bootstrap, route guards
├── config/          ← env vars, constants (no magic numbers in code)
├── games/           ← per-game RPC wrappers + curve / wheel helpers
│   ├── coinflip/   ├── dice/        ├── roulette/
│   ├── blackjack/  ├── crash/       ├── cases/
│   ├── mines/      ├── candy/        ├── gacha/
│   ├── plinko/     ├── lottery/      └── market/
│   ├── multiplayer/
│   └── emoji-hunt/
├── lib/             ← supabase client, logger
├── pages/           ← one page = one file (login, dashboard, events…)
│   └── games/       ← one game page each
├── router/          ← tiny History-API router + route table
├── services/        ← supabase reads + RPC calls (no UI)
├── state/           ← pub/sub stores (userStore, generic createStore)
├── styles/          ← Tailwind entry + custom CSS
├── ui/
│   ├── components/  ← navbar, toast, modal, credit-badge, bet-input…
│   └── layout/      ← app-shell
├── utils/           ← dom, dates, format, random, validation
└── main.js          ← entry point
supabase/
├── schema.sql       ← base tables, RLS, RPCs, triggers
└── migrations/      ← numbered migrations (v2–v16)
│   ├── v2_interactive_blackjack_and_page_hunts.sql
│   ├── v3_cases_multiplayer_peak.sql
│   ├── v4_fixes_and_improvements.sql
│   ├── v5_market_mp_chaos.sql
│   ├── v6_leaderboards.sql
│   ├── v7_autospawn_and_rotation.sql
│   ├── v8_gacha.sql
│   ├── v9_mines_candy.sql
│   ├── v10_admin_bypass.sql
│   ├── v11_emoji_active_pages.sql
│   ├── v12_fixes_tx_lock_key.sql
│   ├── v13_rotation_sync.sql
│   ├── v14_king_of_hill.sql
│   ├── v15_fix_v12_recursion.sql
│   ├── v16_rotation_ambig_fix.sql
│   ├── v17_plinko.sql
│   └── v18_lottery.sql
```

The "many small files" rule: every file owns one job. The biggest files
(by design) are pages with their own DOM trees and the SQL schema.

## Stack choices

- **Vite + vanilla JS modules** — zero React/Vue runtime, fast first
  paint, easy to read for anyone joining.
- **Tailwind 3** — utility-first; full design system in
  `tailwind.config.js`.
- **Supabase** — Postgres + Auth + Realtime in one free tier; idiomatic
  RLS gives us bank-grade isolation without writing a backend.
- **No build-time secrets** — only the public anon key ships to the
  browser.

## Roadmap ideas

- [ ] Provably-fair Crash (HMAC-based commitment + reveal)
- [ ] Discord/Slack webhook on big wins
- [ ] Per-event chat with `realtime.broadcast`
- [ ] Mobile bottom-tab nav
- [ ] PWA install + offline shell

## License

MIT — for entertainment only.
