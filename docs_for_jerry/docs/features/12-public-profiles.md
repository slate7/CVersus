# F12 — Public Profile Pages

## Goal
A shareable, no-auth-required public profile per user showing rank, ELO, tier, W/L record, achievements,
and recent matches — LinkedIn-style.

## Depends on
F08 (shell/router), F11 (match data). Surfaces F14 achievements.

## Touches
- `server.js` — `GET /api/users/:id/public` and a `GET /u/:id` entry (serves the app, routes to the
  public profile view).
- `repo.js` — `publicProfile(userId)` (safe subset).
- `public/index.html` / `client.js` / `style.css` — public profile view.

## Approach
1. `repo.publicProfile(userId)` returns only public-safe fields: `name`, `avatar_url`, `elo`,
   `eloTier` label, `wins`, `losses`, win-rate, achievements, and a few recent results (opponent +
   result only — no transcripts, no resume bytes, no email).
2. `GET /api/users/:id/public` returns it without requiring auth. `GET /u/:id` serves the SPA which
   reads the id from the path/hash and renders the public view.
3. View: header card (avatar, name, tier badge, ELO, W/L), achievements row, recent matches. Add a
   "copy link" / share affordance. Handle unknown id with a 404 state.
4. Do **not** leak private data (email, resume PDF, transcripts) on this route.

## Done when
- Visiting `/u/:id` (logged in or not) shows that user's public stats + achievements.
- No private fields (email, resume bytes, transcripts) appear in the payload or page.
- An invalid id renders a graceful "not found".
