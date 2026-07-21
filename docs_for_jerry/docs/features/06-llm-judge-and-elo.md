# F06 — LLM Judge & ELO Update

## Goal
At call end, a Claude agent judges both resumes + both transcripts head-to-head. Blend its verdict
with the objective resume-score gap into an ELO change, persist the match, and update both players.

## Depends on
F03 (resume `text_extract`, ELO, repo), F05 (transcripts). Uses `ranking.js` `computeEloDelta`.

## Before implementing
Read the `claude-api` skill for current model IDs, SDK usage, and structured-output patterns.
Default model: `claude-sonnet-5`. SDK: `@anthropic-ai/sdk` with `ANTHROPIC_API_KEY`.

## Touches
- New: `judge.js` (prompt + Anthropic call + parse).
- `server.js` — on `call-ending`, gather inputs, call `judge`, compute ELO, `repo.recordMatch` +
  `repo.applyMatchResult`, emit verdict.
- `repo.js` — `recordMatch`, `applyMatchResult` (transactional).

## Approach
1. `judge.js` `judgeMatch({ aResume, bResume, aTranscript, bTranscript })`:
   - System prompt: an impartial technical hiring judge comparing two candidates on concrete
     experience, impact, depth, and how well they explained it. Anonymize sides as "A" / "B".
   - Ask for **strict JSON**: `{ winner: "A"|"B"|"tie", confidence: 0..1, dimensions:[{name,a,b}],
     reasoning: string, tips_a: string, tips_b: string }`. Use a low temperature; validate/parse
     defensively; on parse failure retry once then fall back.
2. Blend: convert verdict → `outcomeA ∈ [0,1]` scaled by `confidence` (e.g. tie → 0.5, win → 0.5 +
   0.5*confidence). Combine with the normalized resume-score gap (e.g. weight 70% verdict / 30% gap;
   document the weights). Feed `computeEloDelta(aElo, bElo, blendedOutcomeA)`.
3. Persist: `recordMatch` (transcripts, `verdict` jsonb, `resume_score_gap`, before/after ELO),
   `applyMatchResult` (update both `elo`, `wins`/`losses` by rounded outcome, streaks).
4. Emit `verdict` to both clients (drives F13). Guard latency/cost: timeout (~20s) and on API error
   fall back to a **resume-score-only** outcome so a match always resolves.

## Done when
- Completing a call produces a Claude verdict, writes one `matches` row, and moves both ELOs/records.
- Both clients receive the verdict payload.
- An API error or unparseable response still resolves the match via the resume-score fallback (no hang).
