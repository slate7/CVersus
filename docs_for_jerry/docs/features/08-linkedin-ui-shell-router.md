# F08 — LinkedIn-Style UI Shell + Router

## Goal
Restyle the app to a LinkedIn aesthetic and turn the single-screen SPA into a tabbed app (Home/Call ·
Leaderboard · Dashboard · Profile) with a lightweight hash router — no build step, still vanilla JS.

## Depends on
F02 (real user for the nav avatar/rank chip). Later view features (F09–F14) mount into these tabs.

## Touches
- `public/style.css` — LinkedIn restyle (card surfaces, muted blues, top nav, system font stack).
- `public/index.html` — nav tabs + avatar/logout; container sections for each route.
- `public/client.js` — generalize `setState` (`client.js:93-97`) into a hash router; rank chip via `eloTier`.

## Approach
1. Router: read `location.hash` (`#/call`, `#/leaderboard`, `#/dashboard`, `#/profile`), show the
   matching top-level view, hide the rest; default `#/call`. Reuse the show/hide pattern from
   `setState`. Keep the in-call screens (`getting-media`, `waiting`, `in-call`, etc.) as sub-states of
   the Call tab so the existing call flow is untouched.
2. Navbar: logo + tab links + user avatar (Google `avatar_url`) + name + ELO rank chip (`eloTier(elo)`
   with tier badge) + logout. Fetch the user from `/api/me`.
3. Restyle: LinkedIn-like palette (white cards on light-grey, `#0a66c2`-style accent), rounded cards,
   subtle borders/shadows, readable type. Keep tier badge colors. Ensure the in-call split view and
   draggable tiles still look right.
4. Guard: unauthenticated users see only the landing + Google sign-in (from F02).

## Done when
- Tabs switch views via hash with no page reload; refreshing a hash lands on that view.
- Nav shows the real avatar, name, and live ELO tier.
- The existing upload → match → call flow works unchanged under the Call tab; UI reads as LinkedIn-like.
