# CVersus

Resume-versus-resume video calls. Upload your resume, click **Join call**, and you get matched with whoever joins next — if no one is there yet, you wait in a waiting room and connect automatically when the next person arrives.

Built with Node.js, Express, Socket.io (signaling), WebRTC (peer-to-peer video/audio), and pdf.js (in-browser resume rendering). No database — everything lives in server memory for the lifetime of each connection.

## Run locally

```
npm install
node server.js
```

Open http://localhost:3000 in two browser tabs to test a call with yourself.

## Features

- **Resume upload** — a PDF resume (max 10 MB) is required before joining; it's scored instantly and kept for the session so you never have to re-upload.
- **Automatic matchmaking** — people are paired in the order they join.
- **Split resume view** — each half of the screen shows one person's resume as a scrollable, zoomable PDF card, with clickable links (email, GitHub, LinkedIn, etc.).
- **Faces-first video** — each person's video is docked large above their own resume, and is draggable/resizable.
- **Mute / camera controls** — icon buttons with visual on/off state, synced to the other person's tile.
- **Ranked tiers** — resumes are scored with a deterministic rubric (open source, projects, experience, skills, plus bonuses/deductions) inspired by HackerRank's published hiring rubric. Scores map to Bronze/Silver/Gold/Platinum/Diamond/Champion tiers with divisions, shown in a navbar profile chip and on each video tile during a call.
- **Anonymous identity** — an auto-generated name (e.g. "Candidate#4821") is stored in your browser; no accounts or sign-up.
- **"Find new call"** when the other person leaves.

## Deployment

Deployed on Render (free tier) as a Node web service: build `npm install`, start `node server.js`. Render provides HTTPS automatically, which browsers require for camera access.

**Notes:**
- The free tier goes to sleep after ~15 minutes of inactivity — the first visit may take 30–60 seconds to load.
- Connections use STUN only (no TURN server), so calls may fail to connect on very strict networks (some campus/corporate Wi-Fi).
- Resume scoring is a self-contained heuristic scorer (no external API calls), so it's free and instant but not a substitute for human judgment.
