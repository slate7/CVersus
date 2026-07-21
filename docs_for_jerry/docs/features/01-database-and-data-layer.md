# F01 — Database & Data Layer

## Goal
Stand up persistent Postgres storage (Neon/Supabase) with an idempotent schema, a single
data-access module, and an admin export route. This is the backbone every later feature reads/writes.

## Depends on
Nothing. (See `00-shared-foundations.md` for the schema and env vars.)

## Touches
- New: `db.js`, `repo.js`, `.env.example`, migrations (inline in `db.js` or a `migrate()` fn).
- `server.js` — call `migrate()` on boot; mount `/admin/export`.
- `package.json` — add `pg`, `dotenv`. `.gitignore` — add `.env`.
- `README.md` — document env vars + how to get a Neon URL.

## Approach
1. `db.js`: create a `pg` `Pool` from `DATABASE_URL` with `ssl: { rejectUnauthorized: false }` (Neon).
   Export `query(text, params)` and the pool.
2. `migrate()`: run `CREATE TABLE IF NOT EXISTS` for `users`, `resumes`, `matches`, `achievements`
   (schema in `00-shared-foundations.md`), plus `CREATE EXTENSION IF NOT EXISTS pgcrypto` for
   `gen_random_uuid()`. Add a partial unique index enforcing one `is_current` resume per user.
   Call it from `server.js` before `server.listen`.
3. `repo.js`: thin functions so no feature writes raw SQL elsewhere. At minimum:
   `upsertUser`, `getUserById`, `saveResume`, `getCurrentResume`, `recordMatch`, `applyMatchResult`
   (updates elo/wins/losses/streaks in a transaction), `topByElo(limit)`, `userStats(userId)`,
   `userMatches(userId, limit)`, `grantAchievement(userId, code)`, `listAchievements(userId)`.
   Stub the ones later features flesh out; implement the ones F01's export needs.
4. `GET /admin/export?token=…`: verify `req.query.token === process.env.ADMIN_TOKEN` (404/401 otherwise).
   Stream a CSV of users joined to their current resume (email, name, elo, score, uploaded_at,
   resume filename). Optionally a `?format=zip` that bundles the PDF bytes. Set `Content-Disposition`.

## Done when
- `npm start` boots, runs `migrate()` with no errors, tables exist in Neon.
- Inserting a test user via `repo.upsertUser` persists across a restart.
- `GET /admin/export?token=<ADMIN_TOKEN>` returns a CSV; wrong/missing token is rejected.

## Notes
- Keep everything parameterized (no string interpolation into SQL).
- `applyMatchResult` must be transactional so both players' ELO/streak updates are atomic.
