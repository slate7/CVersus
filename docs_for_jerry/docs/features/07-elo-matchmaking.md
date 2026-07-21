# F07 — ELO-Based Matchmaking

## Goal
Pair waiting users with the closest ELO instead of the current single-slot FIFO, widening tolerance
over wait time so nobody starves.

## Depends on
F03 (ELO on users). Independent of the judge.

## Touches
- `server.js` — replace the single `waitingSocket` + `join` logic (`server.js:20-21, 90-117`) and the
  waiting-slot cleanup (`server.js:134-146`).

## Approach
1. Replace `waitingSocket` with a waiting **pool**: `Map<socketId, { user, elo, joinedAt }>` (or array).
2. On `join`: require a current resume (persisted per F03). Compute a tolerance that grows with wait
   time, e.g. `tolerance = 50 + 25 * floor(waitedSeconds / 5)` (unbounded after ~30s). Scan the pool
   for the waiting candidate whose `|elo - myElo|` is smallest and within either side's tolerance; if
   found, pair them (remove from pool), else add self to the pool and emit `waiting`.
3. Keep the existing handshake: the one who was **already waiting** becomes `initiator: true`. Preserve
   `peer-resume`/`peer-profile`/timer start on match.
4. Cleanup on `leave`/`disconnect` removes the socket from the pool. Optionally re-scan the pool when
   someone leaves so a widened tolerance can now match two stragglers (a periodic sweep is fine).

## Done when
- With several people waiting, a joiner is matched to the nearest-ELO waiter, not just the oldest.
- A long-waiting user eventually matches anyone (tolerance widens) rather than waiting forever.
- Leaving while waiting removes you from the pool with no orphaned entries.
