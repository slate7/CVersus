# F11 — Match History

## Goal
A per-user list of past matches: opponent, result, ELO change, date, and a short verdict summary —
re-viewable in full.

## Depends on
F06 (matches rows with verdict + before/after ELO).

## Touches
- `server.js` — `GET /api/me/matches`.
- `repo.js` — `userMatches(userId, limit)`.
- `public/index.html` / `client.js` / `style.css` — history list + a reusable "recent matches" widget.

## Approach
1. `repo.userMatches(userId, limit)` → matches where the user is `player_a` or `player_b`, joined to the
   opponent's `name`/`avatar_url`, ordered `created_at DESC`. Normalize per row from the user's
   perspective: `{ opponent, result: win|loss|draw, eloDelta, date, verdictSummary }` (derive delta
   from this user's before/after; pull a one-line summary from `verdict.reasoning`).
2. `GET /api/me/matches` (auth) returns it. Support a `limit` query for the dashboard widget.
3. View: a list showing opponent avatar/name, win/loss chip, ±ELO, date; clicking a row expands the
   full stored `verdict` (dimensions + reasoning + your tips) from F13.
4. Provide a small "recent matches" component the Dashboard (F10) reuses.

## Done when
- The history view lists the user's matches newest-first with correct per-user result and ELO delta.
- Expanding a match shows the stored verdict detail.
- The dashboard's recent-matches widget renders from the same data.
