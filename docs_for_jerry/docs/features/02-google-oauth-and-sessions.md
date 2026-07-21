# F02 — Google OAuth & Sessions

## Goal
Replace anonymous localStorage identity with real Google sign-in. Persist sessions in Postgres so
logins survive redeploys, and bind every Socket.io connection to an authenticated user.

## Depends on
F01 (users table, repo layer).

## Touches
- `server.js` — session middleware, passport setup, auth routes, socket auth middleware, login gate.
- New: `auth.js` (passport strategy + route handlers) to keep `server.js` lean.
- `public/index.html` / `public/client.js` — landing shows "Sign in with Google"; drop the anonymous
  `loadProfile`/`hello` identity (`client.js:18-49, 484-486`); read the real user from a `/api/me` route.
- `README.md` — document Google OAuth client setup + `APP_URL` callback.

## Approach
1. `express-session` with `connect-pg-simple` store (`session` table), `SESSION_SECRET`,
   `cookie: { httpOnly, sameSite:'lax', secure in prod }`.
2. Passport `GoogleStrategy` (`GOOGLE_CLIENT_ID/SECRET`, callback `${APP_URL}/auth/google/callback`).
   In the verify callback, `repo.upsertUser({ google_sub, email, name, avatar_url })`; serialize the
   user id into the session; `deserializeUser` → `repo.getUserById`.
3. Routes: `GET /auth/google`, `GET /auth/google/callback` (redirect to app on success),
   `POST /auth/logout`, and `GET /api/me` (returns the logged-in user or 401).
4. `requireAuth` middleware gating the app shell + all `/api/*` (except public ones). Static landing
   page renders a Google button when unauthenticated.
5. Socket auth: share the session with `io` per `00-shared-foundations.md` (`io.engine.use` +
   `io.use`), set `socket.user`. Reject unauthenticated sockets. Remove the `hello` handler and use
   `socket.user.name/id` instead of the client-supplied name.

## Done when
- Clicking "Sign in with Google" creates/loads a `users` row and returns to the app authenticated.
- `GET /api/me` returns the user; logout clears the session.
- A socket connection carries `socket.user`; unauthenticated sockets are refused.
- Sessions persist across a server restart (stored in Postgres).
