require('dotenv').config({ quiet: true }); // suppress dotenv's stdout promo tips

const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');
const { scoreResume } = require('./scorer');
const db = require('./db');
const repo = require('./repo');
const auth = require('./auth');

const MAX_RESUME_BYTES = 10 * 1024 * 1024; // 10 MB
const SCORE_CACHE_LIMIT = 100;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 12 * 1024 * 1024, // headroom over the 10 MB resume limit
});

// Auth: session (Postgres-backed) + passport must be wired before the routes and static shell.
auth.configurePassport();
app.use(auth.sessionMiddleware);
app.use(auth.passport.initialize());
app.use(auth.passport.session());
auth.mountAuthRoutes(app); // /auth/google, /auth/google/callback, /auth/logout, /api/me

// Share the same session with Socket.io so every socket is bound to a logged-in user.
io.engine.use(auth.sessionMiddleware);
io.use(auth.socketAuth);

app.use(express.static('public'));
app.use('/pdfjs', express.static(path.join(__dirname, 'node_modules', 'pdfjs-dist', 'build')));

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

app.get('/admin/export', async (req, res) => {
  if (!process.env.ADMIN_TOKEN || req.query.token !== process.env.ADMIN_TOKEN) {
    return res.status(404).end();
  }
  if (req.query.format === 'zip') {
    return res.status(501).json({ error: 'zip export is not implemented yet (deferred from F01)' });
  }

  try {
    const rows = await repo.exportUsersWithResumes();
    const header = ['email', 'name', 'elo', 'score', 'uploaded_at', 'filename'];
    const lines = [header.join(',')];
    for (const row of rows) {
      lines.push([
        csvEscape(row.email),
        csvEscape(row.name),
        row.elo,
        row.score ?? '',
        row.uploaded_at ? new Date(row.uploaded_at).toISOString() : '',
        csvEscape(row.filename ?? ''),
      ].join(','));
    }
    const csv = lines.join('\r\n') + '\r\n';

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cversus-export-${Date.now()}.csv"`);
    res.status(200).send(csv);
  } catch (err) {
    console.error('[admin/export] failed', err);
    res.status(500).json({ error: 'export failed' });
  }
});

// Matchmaking state: one waiting slot + who is paired with whom
let waitingSocket = null;
const partnerOf = new Map(); // socket.id -> partner socket.id
const resumes = new Map(); // socket.id -> Buffer (uploaded resume PDF)
const profiles = new Map(); // socket.id -> { name }
const ranks = new Map(); // socket.id -> scorer result

// Scoring is deterministic and pure, so identical bytes never need rescoring.
const scoreCache = new Map(); // sha256 hex -> scorer result

function sanitizeName(raw) {
  const name = String(raw || '').trim().replace(/[<>]/g, '').slice(0, 24);
  return name || 'Candidate';
}

const UNRANKED = { score: 0, tier: null, division: null, cssClass: 'tier-unranked', label: 'Unranked', breakdown: null, unscoreable: true };

function publicProfile(id) {
  const profile = profiles.get(id);
  const rank = ranks.get(id) || UNRANKED;
  return {
    name: (profile && profile.name) || 'Candidate',
    score: rank.score,
    tier: rank.tier,
    division: rank.division,
    cssClass: rank.cssClass,
    label: rank.label,
    unscoreable: rank.unscoreable,
  };
}

io.on('connection', (socket) => {
  console.log(`connected: ${socket.id} (user ${socket.user.id})`);

  // Identity now comes from the authenticated session, not a client-supplied `hello`.
  profiles.set(socket.id, { name: sanitizeName(socket.user.name) });

  socket.on('resume', async (data, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const buf = Buffer.isBuffer(data) ? data : data instanceof ArrayBuffer ? Buffer.from(data) : null;
    if (!buf) return reply({ ok: false, error: 'Invalid upload.' });
    if (buf.length > MAX_RESUME_BYTES) return reply({ ok: false, error: 'PDF is larger than 10 MB.' });
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
      return reply({ ok: false, error: 'File is not a valid PDF.' });
    }
    resumes.set(socket.id, buf);

    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    let result = scoreCache.get(hash);
    if (!result) {
      try {
        result = await scoreResume(buf);
      } catch (err) {
        console.error('scoring failed:', err);
        result = UNRANKED;
      }
      if (scoreCache.size >= SCORE_CACHE_LIMIT) {
        scoreCache.delete(scoreCache.keys().next().value);
      }
      scoreCache.set(hash, result);
    }

    // A newer upload may have landed while we were scoring; don't clobber it.
    if (resumes.get(socket.id) === buf) {
      ranks.set(socket.id, result);
    }
    reply({ ok: true, ...result });
  });

  socket.on('join', () => {
    if (!resumes.has(socket.id)) {
      socket.emit('join-rejected', { reason: 'no-resume' });
      return;
    }
    // Ignore double-joins
    if (waitingSocket === socket || partnerOf.has(socket.id)) return;

    if (waitingSocket === null) {
      waitingSocket = socket;
      socket.emit('waiting');
      console.log(`waiting: ${socket.id}`);
    } else {
      const partner = waitingSocket;
      waitingSocket = null;
      partnerOf.set(socket.id, partner.id);
      partnerOf.set(partner.id, socket.id);
      // The one who was waiting creates the WebRTC offer
      partner.emit('matched', { initiator: true });
      socket.emit('matched', { initiator: false });
      // Per-connection ordering guarantees 'matched' arrives before these
      partner.emit('peer-resume', resumes.get(socket.id));
      socket.emit('peer-resume', resumes.get(partner.id));
      partner.emit('peer-profile', publicProfile(socket.id));
      socket.emit('peer-profile', publicProfile(partner.id));
      console.log(`matched: ${partner.id} <-> ${socket.id}`);
    }
  });

  socket.on('signal', (payload) => {
    const partnerId = partnerOf.get(socket.id);
    if (partnerId) io.to(partnerId).emit('signal', payload);
  });

  socket.on('media-state', (payload) => {
    const partnerId = partnerOf.get(socket.id);
    if (partnerId) {
      io.to(partnerId).emit('media-state', {
        mic: !!(payload && payload.mic),
        cam: !!(payload && payload.cam),
      });
    }
  });

  const cleanup = () => {
    if (waitingSocket === socket) {
      waitingSocket = null;
      console.log(`left while waiting: ${socket.id}`);
    }
    const partnerId = partnerOf.get(socket.id);
    if (partnerId) {
      io.to(partnerId).emit('peer-left');
      partnerOf.delete(partnerId);
      partnerOf.delete(socket.id);
      console.log(`call ended: ${socket.id} left ${partnerId}`);
    }
  };

  socket.on('leave', cleanup);
  socket.on('disconnect', () => {
    cleanup();
    resumes.delete(socket.id);
    profiles.delete(socket.id);
    ranks.delete(socket.id);
    console.log(`disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;

db.migrate()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`CVersus running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[db] migrate() failed — server not started', err);
    process.exit(1);
  });
