const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// Matchmaking state: one waiting slot + who is paired with whom
let waitingSocket = null;
const partnerOf = new Map(); // socket.id -> partner socket.id

io.on('connection', (socket) => {
  console.log(`connected: ${socket.id}`);

  socket.on('join', () => {
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
      console.log(`matched: ${partner.id} <-> ${socket.id}`);
    }
  });

  socket.on('signal', (payload) => {
    const partnerId = partnerOf.get(socket.id);
    if (partnerId) io.to(partnerId).emit('signal', payload);
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
    console.log(`disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`CVersus running on http://localhost:${PORT}`);
});
