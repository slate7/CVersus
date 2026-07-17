# CVersus

A 1-on-1 video calling website. Click **Join call** and you get matched with whoever joins next — if no one is there yet, you wait in a waiting room and connect automatically when the next person arrives.

Built with Node.js, Express, Socket.io (signaling), and WebRTC (peer-to-peer video/audio). No database — matchmaking happens in server memory.

## Run locally

```
npm install
node server.js
```

Open http://localhost:3000 in two browser tabs to test a call with yourself.

## Features

- Automatic matchmaking (people are paired in the order they join)
- Side-by-side video call with audio
- Mute microphone and camera on/off toggles
- "Find new call" when the other person leaves

## Deployment

Deployed on Render (free tier) as a Node web service: build `npm install`, start `node server.js`. Render provides HTTPS automatically, which browsers require for camera access.

**Notes:**
- The free tier goes to sleep after ~15 minutes of inactivity — the first visit may take 30–60 seconds to load.
- Connections use STUN only (no TURN server), so calls may fail to connect on very strict networks (some campus/corporate Wi-Fi).
