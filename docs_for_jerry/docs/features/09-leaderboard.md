# F09 — Leaderboard (Top 50 by ELO)

## Goal
A leaderboard tab ranking the top 50 players by **ELO** (explicitly not raw resume score).

## Depends on
F03 (ELO), F08 (tab shell + router).

## Touches
- `server.js` — `GET /api/leaderboard`.
- `repo.js` — `topByElo(limit)`.
- `public/index.html` / `client.js` / `style.css` — leaderboard view.

## Approach
1. `repo.topByElo(50)` → `SELECT id, name, avatar_url, elo, wins, losses FROM users
   ORDER BY elo DESC LIMIT 50`. Map each to `{ rank, name, avatar, elo, tier: eloTier(elo).label, wins, losses }`.
2. `GET /api/leaderboard` (auth required) returns that array.
3. View: ranked table/list with position, avatar, name, tier badge, ELO, W/L. Highlight the current
   user's row; if they're outside the top 50, optionally append their own rank at the bottom.
4. Empty/low-population state: render gracefully with however many rows exist.

## Done when
- The Leaderboard tab shows up to 50 users ordered by ELO descending, with tier badges and W/L.
- The signed-in user's row is highlighted (or appended if outside the top 50).
- Ordering is by ELO, never resume score.
