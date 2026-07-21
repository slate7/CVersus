# CVersus

Resume-versus-resume video calls. Upload your resume, click **Join call**, and you get matched with whoever joins next — if no one is there yet, you wait in a waiting room and connect automatically when the next person arrives.

Built with Node.js, Express, Socket.io (signaling), WebRTC (peer-to-peer video/audio), and pdf.js (in-browser resume rendering). Postgres (Neon) persists users, resumes, matches, and achievements; the live video-call matchmaking state itself still lives in server memory for the lifetime of each connection until a later feature migrates it.

## Run locally

```
npm install
node server.js
```

Open http://localhost:3000 in two browser tabs to test a call with yourself.

## Environment variables

Copy `.env.example` to `.env` and fill in real values. `.env` is git-ignored.

| Var | Required for | Purpose |
|---|---|---|
| `DATABASE_URL` | database layer | Neon/Supabase Postgres connection string (SSL). |
| `ADMIN_TOKEN` | database layer | Guards `GET /admin/export`. |
| `PORT` | optional | Existing; defaults to 3000. |

Without `DATABASE_URL` set, the app still boots and the existing video-call flow works;
DB-backed features (schema migration, `/admin/export`) are simply unavailable until it's configured.

## Database (Neon) setup

1. Create a free project at https://neon.tech.
2. In the Neon console, open your project's **Connection Details** and copy the pooled connection
   string (it includes `?sslmode=require`).
3. Paste it into `.env` as `DATABASE_URL=...`.
4. Run `npm start` — on boot the server runs an idempotent migration that creates the `users`,
   `resumes`, `matches`, and `achievements` tables if they don't already exist.
5. Generate a random value for `ADMIN_TOKEN` (e.g. `openssl rand -hex 24`) and set it in `.env`.

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
