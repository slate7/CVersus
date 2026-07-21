# F04 — 5-Minute Call Timer

## Goal
Every matched call is a server-authoritative 5-minute (300s) ranked round that auto-ends into the
judging phase.

## Depends on
Existing call flow (`matched`/`signal`). Judging itself is F06; this feature just drives the phase change.

## Touches
- `server.js` — start/track/cancel a timer per matched pair around `server.js:102-117` and `cleanup`.
- `public/index.html` / `public/client.js` — countdown UI in the in-call screen; stop-capture + results
  transition on end.

## Approach
1. On match, record a `deadline = Date.now() + 300_000` for the pair and emit `call-started { deadline }`
   to both. Prefer sending the absolute deadline (clients compute their own countdown) over ticking
   every second; optionally emit a coarse `timer` sync every ~15s to correct drift.
2. Server sets a `setTimeout` for 300s → emit `call-ending` to both → proceed to F06 (judging).
   Store the timeout handle so `leave`/`disconnect` can cancel it.
3. Early hangup/disconnect before the deadline: cancel the timer. Decide + document behavior — either
   **no ranked result** (call voided) or **forfeit** (the leaver loses). Recommend: leaving early =
   forfeit only if both transcripts have meaningful content, else void. Keep it simple; note the choice.
4. Client: render a `MM:SS` countdown in `#controls`/navbar during the call; at `call-ending` stop mic
   capture (F05) and show a "judging…" state, then the results screen (F13).

## Done when
- Both clients show a synced countdown that reaches 0:00 together.
- At 0:00 the server emits `call-ending` and both clients leave the talk phase.
- Hanging up early cancels the timer cleanly (no orphaned timeouts, documented void/forfeit rule).
