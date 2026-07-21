# CVersus Feature Specs

This directory breaks the "Ranked, Persistent, AI-Judged Platform" build into self-contained
feature files. Each file is written so Claude can be pointed at **one** file and implement that
feature in isolation. Build in numeric order — each feature depends on the ones above it.

Read [`00-shared-foundations.md`](00-shared-foundations.md) first: it defines the database schema,
the `ranking.js` module, session-authenticated sockets, new dependencies, and env vars that every
other feature relies on.

## Build order

| # | File | Feature | Depends on |
|---|---|---|---|
| — | [`00-shared-foundations.md`](00-shared-foundations.md) | Schema, ranking module, deps, env, socket auth (reference) | — |
| F01 | [`01-database-and-data-layer.md`](01-database-and-data-layer.md) | Postgres connection, migrations, repo layer, admin export | — |
| F02 | [`02-google-oauth-and-sessions.md`](02-google-oauth-and-sessions.md) | Google sign-in, sessions, socket auth, login gate | F01 |
| F03 | [`03-persistent-profile-resume-elo.md`](03-persistent-profile-resume-elo.md) | Resume/score/ELO moved to DB; seed ELO; versioning | F01, F02 |
| F04 | [`04-call-timer.md`](04-call-timer.md) | Server-authoritative 5-min timer → judging phase | call flow |
| F05 | [`05-voice-transcription.md`](05-voice-transcription.md) | Per-client Web Speech transcript → server | F04 |
| F06 | [`06-llm-judge-and-elo.md`](06-llm-judge-and-elo.md) | Claude judge, blend with resume gap, update ELO | F03, F05 |
| F07 | [`07-elo-matchmaking.md`](07-elo-matchmaking.md) | ELO-nearest matchmaking pool | F03 |
| F08 | [`08-linkedin-ui-shell-router.md`](08-linkedin-ui-shell-router.md) | LinkedIn restyle, tab nav, hash router | F02 |
| F09 | [`09-leaderboard.md`](09-leaderboard.md) | Top-50-by-ELO route + view | F03, F08 |
| F10 | [`10-personal-dashboard.md`](10-personal-dashboard.md) | Auth-gated stats + ELO progression chart | F06, F08 |
| F11 | [`11-match-history.md`](11-match-history.md) | Per-user match list | F06 |
| F12 | [`12-public-profiles.md`](12-public-profiles.md) | Shareable public profile pages | F08, F11 |
| F13 | [`13-ai-verdict-feedback.md`](13-ai-verdict-feedback.md) | Post-call verdict + improvement tips | F06 |
| F14 | [`14-achievements-streaks.md`](14-achievements-streaks.md) | Badge engine + streaks | F06, F10 |

## How to use
Point Claude at a single file, e.g. *"implement `docs/features/01-database-and-data-layer.md`"*.
Each spec has **Goal / Touches / Depends on / Approach / Done when** so it can be executed and
verified on its own.

Full context and rationale live in the approved plan at `.claude/plans/velvety-seeking-clock.md`.
