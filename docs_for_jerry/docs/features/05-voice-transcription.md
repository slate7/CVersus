# F05 — Voice Transcription (Web Speech API)

## Goal
Capture each candidate's spoken explanation during the call as text, attributed per speaker, ready for
the judge. Each browser transcribes its **own** mic locally — attribution is free (whichever client
produced the transcript).

## Depends on
F04 (timer/phase drives start & stop).

## Touches
- `public/client.js` — SpeechRecognition lifecycle + a `transcript` emit.
- `server.js` — buffer `a_transcript`/`b_transcript` per match.
- `public/index.html` — a consent banner before matchmaking.

## Approach
1. Client: `const SR = window.SpeechRecognition || window.webkitSpeechRecognition`. If absent, degrade
   gracefully (skip transcription; the judge falls back to resumes only) and inform the user.
2. Configure `continuous = true`, `interimResults = false`, `lang = 'en-US'`. Start when the call
   starts; on `onresult` append finalized `transcript` segments to a local buffer and emit
   `transcript { text }` (append-only chunks). `onend` → restart while still in-call (the API stops
   periodically). Stop fully on `call-ending`/hangup.
3. Server: accumulate text per user into the match's `a_transcript`/`b_transcript` (map socket.user.id
   → side). Cap total length (e.g. ~8k chars) to bound judge cost.
4. Consent: before entering matchmaking, show a clear banner — "This call is transcribed on-device and
   the transcript + your resume are sent to an AI judge to decide the match." Require acknowledgement.

## Done when
- During a call, speaking populates a growing local transcript and the server receives attributed chunks.
- At `call-ending`, the server holds two transcripts keyed to the two users.
- A browser without SpeechRecognition still completes a call (judge uses resumes only) with a notice.
