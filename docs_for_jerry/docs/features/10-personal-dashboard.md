# F10 — Personal Dashboard

## Goal
An auth-gated dashboard where a user tracks their own progression: ELO, tier, W/L, streaks, an
ELO-over-time chart, and recent results.

## Depends on
F06 (matches produce stats/ELO history), F08 (tab shell). Reuses F11's recent-matches widget.

## Touches
- `server.js` — `GET /api/me/stats`.
- `repo.js` — `userStats(userId)`.
- `public/index.html` / `client.js` / `style.css` — dashboard view + chart.

## Approach
1. `repo.userStats(userId)` returns: current `elo`, `eloTier` label/division, `wins`, `losses`,
   win-rate, `current_streak`, `best_streak`, and an ELO time-series derived from `matches`
   (each match's `*_elo_after` for this user, ordered by `created_at`), plus the last N results.
2. `GET /api/me/stats` (auth) returns it.
3. View: stat cards (ELO + tier badge, W/L, win-rate, streak) and an **ELO progression chart** drawn
   with inline SVG or canvas — no external chart library (keep it self-contained / CSP-safe). Include
   a compact "recent matches" list (shared with F11).
4. Empty state (no matches yet): show seeded ELO and a "play your first match" prompt.

## Done when
- The Dashboard tab shows the signed-in user's live ELO, tier, W/L, streak, and a progression chart.
- The chart reflects real per-match ELO history and updates after new matches.
