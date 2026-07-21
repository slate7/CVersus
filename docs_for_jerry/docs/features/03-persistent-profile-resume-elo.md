# F03 — Persistent Profile, Resume & ELO

## Goal
Move resume bytes, score, and ELO out of in-memory Maps into Postgres, keyed to the authenticated
user. Seed ELO on first resume and support re-upload (versioning).

## Depends on
F01 (DB/repo), F02 (authenticated sockets).

## Touches
- `server.js` — rework the `resume` handler (`server.js:58-88`); remove in-memory `resumes`/`ranks`/
  `profiles` Maps (`server.js:23-25`) as the source of truth.
- `repo.js` — `saveResume`, `getCurrentResume`, seed-ELO logic.
- `public/client.js` — read persisted rank from `/api/me` instead of `localStorage['cversus-rank']`
  (`client.js:33-49, 273, 346`); resume can be re-fetched rather than re-sent each join.

## Approach
1. On `resume` upload: validate + `scoreResume` (unchanged), then `repo.saveResume` — insert a new
   `resumes` row (bytea + score + breakdown + `text_extract`), flip prior `is_current=false`. Cache
   `text_extract` by content hash (reuse the `scoreCache` pattern) to skip rescoring identical PDFs.
2. Seed ELO: if the user has no prior matches, set/keep `users.elo = 1000` on first resume (optionally
   nudge slightly by resume score, but keep ELO the competitive axis — resume score stays separate).
   Store `users.resume_score` = latest score.
3. Peer resume delivery in-call: keep a small per-match in-memory cache of the two PDFs (fetched from
   DB at match time) so the existing `peer-resume` byte push (`server.js:111-112`) still works without
   a DB read per frame.
4. `matched`/`join` no longer requires the client to re-send bytes each time — the server loads the
   current resume from DB. (Keep client re-send as a fallback if desired.)

## Done when
- Uploading a resume writes a `resumes` row (bytea present) and sets `users.resume_score` + seeded `elo`.
- Logging out and back in shows the same resume + rank (no localStorage dependence).
- Re-uploading creates a new `is_current` row; the peer still sees your current resume in-call.
