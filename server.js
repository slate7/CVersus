const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const MAX_RESUME_BYTES = 10 * 1024 * 1024; // 10 MB

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 12 * 1024 * 1024, // headroom over the 10 MB resume limit
});

app.use(express.static('public'));
app.use('/pdfjs', express.static(path.join(__dirname, 'node_modules', 'pdfjs-dist', 'build')));

// Matchmaking state: one waiting slot + who is paired with whom
let waitingSocket = null;
const partnerOf = new Map(); // socket.id -> partner socket.id
const resumes = new Map(); // socket.id -> Buffer (uploaded resume PDF)

io.on('connection', (socket) => {
  console.log(`connected: ${socket.id}`);

  socket.on('resume', (data, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const buf = Buffer.isBuffer(data) ? data : data instanceof ArrayBuffer ? Buffer.from(data) : null;
    if (!buf) return reply({ ok: false, error: 'Invalid upload.' });
    if (buf.length > MAX_RESUME_BYTES) return reply({ ok: false, error: 'PDF is larger than 10 MB.' });
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
      return reply({ ok: false, error: 'File is not a valid PDF.' });
    }
    resumes.set(socket.id, buf);
    reply({ ok: true });
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
      // Per-connection ordering guarantees 'matched' arrives before 'peer-resume'
      partner.emit('peer-resume', resumes.get(socket.id));
      socket.emit('peer-resume', resumes.get(partner.id));
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
    console.log(`disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`CVersus running on http://localhost:${PORT}`);
});
