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
  admins unlimited). Pari-mutuel pool with 5% house fee. Realtime updates
  to all viewers.
- 🪙🎲🎡🃏🚀 **Mini-games** — Coinflip, Dice, Roulette, Blackjack and
  Crash, all server-resolved (the client cannot cheat).
- 👀 **Emoji hunts** — admins (or random scheduled spawns you can wire up)
  drop a glowing emoji at a random screen position. **First click wins**
  — resolved atomically in Postgres.
- 🏆 **Live leaderboard** & **transaction history**.
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
`play_blackjack`, `play_crash`, `place_event_bet`, `resolve_event`,
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
│   ├── blackjack/  ├── crash/       └── emoji-hunt/
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
└── schema.sql       ← single SQL file: tables, RLS, RPCs, triggers
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
- [ ] Scheduled cron in Supabase Edge Function to auto-spawn emoji hunts
- [ ] Discord/Slack webhook on big wins
- [ ] Per-event chat with `realtime.broadcast`
- [ ] Mobile bottom-tab nav
- [ ] PWA install + offline shell

## License

MIT — for entertainment only.
