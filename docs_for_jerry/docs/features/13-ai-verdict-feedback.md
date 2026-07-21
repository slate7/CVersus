# F13 — AI Verdict Feedback

## Goal
After each call, show both players a results screen: who won, a per-dimension comparison, the judge's
reasoning, and concrete tips for presenting their experience better next time (emphasized for the loser).

## Depends on
F06 (verdict payload + persisted `matches.verdict`).

## Touches
- `public/index.html` / `client.js` / `style.css` — a results/verdict screen in the call flow.
- (Read-only) reuse the stored `verdict` from F11 for re-viewing past matches.

## Approach
1. On the `verdict` event (from F06), transition from the "judging…" state to a results screen:
   - Outcome banner: Win / Loss / Draw + the ELO delta (with new ELO + tier).
   - Per-dimension comparison (`dimensions[]`: name, your score vs opponent) as simple bars.
   - The judge's `reasoning`.
   - **Your tips** (`tips_a`/`tips_b` for the right side) prominently — especially on a loss.
   - Buttons: "Find new call" (re-enter matchmaking) and "View dashboard".
2. Map the anonymized A/B verdict back to "you" vs "opponent" for the local client.
3. Make the same rendering reusable so F11 can show a stored verdict when expanding a past match.

## Done when
- At call end both players see their tailored result: outcome, ELO change, dimensions, reasoning, tips.
- The loser's improvement tips are clearly surfaced.
- The same view renders a stored verdict from match history.
