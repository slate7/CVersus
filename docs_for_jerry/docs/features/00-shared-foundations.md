# F00 — Shared Foundations (reference, not a standalone build)

Everything the feature files rely on. Read before implementing any feature; F01/F02 create most of it.

## New dependencies
```
pg express-session connect-pg-simple passport passport-google-oauth20 @anthropic-ai/sdk dotenv
```
(`google-auth-library` is an acceptable alternative to passport if preferred.)

## Env vars
Document in `README.md` and provide `.env.example`. Keep real `.env` git-ignored (add `.env` to `.gitignore`).
Load with `dotenv` at the top of `server.js`.

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Neon/Supabase Postgres connection string (SSL). |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth client. |
| `SESSION_SECRET` | Signs session cookies. |
| `ANTHROPIC_API_KEY` | Claude judge (F06). |
| `ADMIN_TOKEN` | Guards `/admin/export`. |
| `APP_URL` | Base URL for the OAuth callback (e.g. `http://localhost:3000`). |
| `PORT` | Existing. |

## Database schema (Postgres)
Created idempotently by `migrate()` in F01.

- **users**: `id uuid pk default gen_random_uuid()`, `email text unique not null`, `name text`,
  `avatar_url text`, `google_sub text unique`, `elo int not null default 1000`, `resume_score int`,
  `wins int default 0`, `losses int default 0`, `current_streak int default 0`, `best_streak int default 0`,
  `created_at timestamptz default now()`.
- **resumes**: `id uuid pk`, `user_id uuid fk→users`, `pdf_bytes bytea`, `filename text`, `score int`,
  `breakdown jsonb`, `text_extract text`, `is_current bool default true`, `uploaded_at timestamptz default now()`.
  (Only one `is_current=true` per user.)
- **matches**: `id uuid pk`, `player_a uuid fk`, `player_b uuid fk`, `winner_id uuid null` (null = draw),
  `a_transcript text`, `b_transcript text`, `verdict jsonb`, `resume_score_gap int`,
  `a_elo_before int`, `a_elo_after int`, `b_elo_before int`, `b_elo_after int`, `created_at timestamptz default now()`.
- **achievements**: `id uuid pk`, `user_id uuid fk`, `code text`, `earned_at timestamptz default now()`,
  `unique(user_id, code)`.
- **session**: table owned by `connect-pg-simple` (its default DDL).

## `ranking.js` (shared module)
Extract the tier/division helpers currently in `scorer.js:13-36` into a new `ranking.js`. `scorer.js`
keeps `scoreResume`/`extractPdfText` and imports labels from `ranking.js` if it still needs them.

- `TIERS` + `eloTier(elo) → { tier, division, cssClass, label }` — ELO bands (not resume score) map to
  Bronze…Champion with I/II/III divisions, reusing the existing output shape. Pick bands spanning a
  ~600–2400 ELO range (e.g. Bronze <1100, Silver 1100, Gold 1250, Platinum 1450, Diamond 1700,
  Champion 2000; divisions by offset within a band, mirroring `tierFor`).
- `computeEloDelta(ratingA, ratingB, outcomeA, k=32)` — standard Elo:
  `expectedA = 1/(1+10**((ratingB-ratingA)/400))`; `deltaA = round(k*(outcomeA - expectedA))`;
  `outcomeA ∈ [0,1]` (1 win, 0 loss, 0.5 draw, fractional for blended outcomes).

Client mirrors `eloTier` bands (or fetches tier from the server) so the nav rank chip matches.

## Session-authenticated sockets
Share the Express session with Socket.io so every socket is bound to a logged-in user (built in F02):
```js
const sessionMiddleware = session({ /* store: connect-pg-simple, secret, cookie */ });
app.use(sessionMiddleware);
io.engine.use(sessionMiddleware); // socket.io v4: reuse the same middleware
io.use((socket, next) => {
  const user = socket.request.session?.passport?.user;
  if (!user) return next(new Error('unauthenticated'));
  socket.user = user; // { id, name, ... }
  next();
});
```
This replaces the anonymous `hello`/localStorage identity in `client.js:18-49`.

## Reuse (don't rebuild)
- `scorer.js` `scoreResume` + `extractPdfText` — resume scoring and `text_extract` for the judge.
- WebRTC signaling + `media-state` relay (`server.js:119-132`), in-call UI, draggable tiles, `pdf-viewer.js` — as-is.
- `setState` screen router (`client.js:93-97`) generalizes into the F08 tab router.
- `scoreCache` content-hash pattern (`server.js:28,68-80`) — cache `text_extract` to skip rescoring identical PDFs.
