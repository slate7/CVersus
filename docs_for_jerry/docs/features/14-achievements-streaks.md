# F14 — Achievements & Streaks

## Goal
Reward milestones with badges (win streaks, tier promotions, first Diamond, N calls, first win, …),
granted after each match and surfaced on the dashboard and public profile.

## Depends on
F06 (match results + streak fields), F10 (dashboard surface). Also shown on F12 profiles.

## Touches
- New: `achievements.js` (rule definitions + evaluator).
- `server.js` — invoke the evaluator after `applyMatchResult` in the F06 flow; emit newly-earned badges.
- `repo.js` — `grantAchievement`, `listAchievements` (from F01).
- `public/*` — badge display on dashboard + public profile; a small "achievement unlocked" toast.

## Approach
1. `achievements.js`: an array of rules, each `{ code, label, description, test(ctx) }` where `ctx`
   includes the user's post-match stats (`wins`, `losses`, `current_streak`, `best_streak`, `elo`,
   `eloTier`, total matches, whether this was their first win, etc.). Example codes: `first_win`,
   `win_streak_3`, `win_streak_5`, `reached_gold/platinum/diamond/champion`, `matches_10`, `matches_50`.
2. After each match, run all rules for each participant; for those that pass, `repo.grantAchievement`
   (idempotent via the `unique(user_id, code)` constraint — ignore conflicts). Collect the *newly*
   inserted ones and emit `achievement-unlocked` to that client.
3. Client: show a toast for newly-unlocked badges post-match; render the earned set on the dashboard
   (F10) and public profile (F12) with label + description + earned date.

## Done when
- Crossing a milestone (e.g. a 3-win streak or reaching Gold) grants the badge exactly once.
- The badge appears on the dashboard and public profile and toasts on unlock.
- Re-evaluating already-earned badges is a no-op (no duplicates).
