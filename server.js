const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const START_PORT = parseInt(process.env.PORT) || 3000;

// Serve static files
app.use(express.static(__dirname));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ─── In-memory user registry ──────────────────────────────────────────────────
// Map of socketId -> { socketId, username, emoji, status: 'lobby' | 'playing' }
const users = new Map();

// Active matches: matchId -> { white: socketId, black: socketId }
const matches = new Map();

// ─── Socket.io Events ─────────────────────────────────────────────────────────
io.on('connection', (socket) => {

  // ── Registration ────────────────────────────────────────────────────────────
  socket.on('register_user', ({ username, emoji }) => {
    users.set(socket.id, { socketId: socket.id, username, emoji, status: 'lobby' });

    // Confirm registration to the client
    socket.emit('registered', { socketId: socket.id });

    // Broadcast updated lobby to everyone
    broadcastLobby();
  });

  // ── Challenge ──────────────────────────────────────────────────────────────
  socket.on('send_challenge', ({ targetSocketId, color, timeSeconds, incrementSeconds }) => {
    const challenger = users.get(socket.id);
    const target = users.get(targetSocketId);
    if (!challenger || !target || target.status !== 'lobby') return;

    // Forward challenge to target
    io.to(targetSocketId).emit('challenge_received', {
      fromSocketId: socket.id,
      username: challenger.username,
      emoji: challenger.emoji,
      requestedColor: color || 'random',
      timeSeconds: timeSeconds || 180,
      incrementSeconds: incrementSeconds || 0
    });
  });

  socket.on('cancel_challenge', ({ targetSocketId }) => {
    // Notify the target that the challenge was cancelled
    io.to(targetSocketId).emit('challenge_cancelled', {
      fromSocketId: socket.id
    });
  });

  socket.on('challenge_response', ({ fromSocketId, accepted, color, timeSeconds, incrementSeconds }) => {
    const responder = users.get(socket.id);
    const challenger = users.get(fromSocketId);

    if (!accepted) {
      io.to(fromSocketId).emit('challenge_declined', {
        username: responder ? responder.username : 'Opponent'
      });
      return;
    }

    if (!responder || !challenger) return;

    // Assign final colors based on request
    let whiteId, blackId;
    if (color === 'white') {
      whiteId = fromSocketId;
      blackId = socket.id;
    } else if (color === 'black') {
      whiteId = socket.id;
      blackId = fromSocketId;
    } else {
      // Random
      if (Math.random() > 0.5) {
        whiteId = fromSocketId;
        blackId = socket.id;
      } else {
        whiteId = socket.id;
        blackId = fromSocketId;
      }
    }

    // Pair them into a match
    const matchId = `${fromSocketId}:${socket.id}`;
    matches.set(matchId, { white: whiteId, black: blackId });

    // Mark both as playing
    if (users.has(fromSocketId)) users.get(fromSocketId).status = 'playing';
    if (users.has(socket.id)) users.get(socket.id).status = 'playing';

    // Notify both players of match start
    io.to(whiteId).emit('match_started', {
      matchId,
      color: 'white',
      opponent: { username: users.get(blackId).username, emoji: users.get(blackId).emoji },
      timeSeconds: timeSeconds || 180,
      incrementSeconds: incrementSeconds || 0
    });
    io.to(blackId).emit('match_started', {
      matchId,
      color: 'black',
      opponent: { username: users.get(whiteId).username, emoji: users.get(whiteId).emoji },
      timeSeconds: timeSeconds || 180,
      incrementSeconds: incrementSeconds || 0
    });

    // Refresh lobby for remaining players
    broadcastLobby();
  });

  // ── In-game Move ─────────────────────────────────────────────────────────────
  socket.on('make_move', ({ matchId, fromRow, fromCol, toRow, toCol }) => {
    const match = matches.get(matchId);
    if (!match) return;

    // Relay move to the opponent
    const opponentSocketId = match.white === socket.id ? match.black : match.white;
    io.to(opponentSocketId).emit('move_received', { fromRow, fromCol, toRow, toCol });
  });

  // ── Match Actions ───────────────────────────────────────────────────────────
  socket.on('resign', ({ matchId }) => {
    const match = matches.get(matchId);
    if (!match) return;

    const opponentId = match.white === socket.id ? match.black : match.white;
    const winner = match.white === socket.id ? 'black' : 'white';

    io.to(opponentId).emit('game_over', { winner, reason: 'resignation' });
    io.to(socket.id).emit('game_over', { winner, reason: 'resignation' });

    endMatch(matchId);
  });

  socket.on('draw_offer', ({ matchId }) => {
    const match = matches.get(matchId);
    if (!match) return;
    const opponentId = match.white === socket.id ? match.black : match.white;
    io.to(opponentId).emit('draw_offered');
  });

  socket.on('draw_response', ({ matchId, accepted }) => {
    const match = matches.get(matchId);
    if (!match) return;
    const challengerId = match.white === socket.id ? match.black : match.white;

    if (accepted) {
      io.to(match.white).emit('game_over', { winner: 'draw', reason: 'draw_agreement' });
      io.to(match.black).emit('game_over', { winner: 'draw', reason: 'draw_agreement' });
      endMatch(matchId);
    } else {
      io.to(challengerId).emit('draw_declined');
    }
  });

  socket.on('game_over', ({ matchId, winner, reason }) => {
    const match = matches.get(matchId);
    if (!match) return;

    const opponentId = match.white === socket.id ? match.black : match.white;
    io.to(opponentId).emit('game_over', { winner, reason });
    io.to(socket.id).emit('game_over', { winner, reason });

    endMatch(matchId);
  });

  socket.on('send_chat_message', ({ matchId, message }) => {
    const match = matches.get(matchId);
    if (!match) return;

    const opponentSocketId = match.white === socket.id ? match.black : match.white;
    io.to(opponentSocketId).emit('chat_message_received', {
      message,
      sender: socket.id
    });
  });

  // ── Disconnect ───────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (!user) return;

    // If they were in a match, notify opponent
    for (const [matchId, match] of matches.entries()) {
      if (match.white === socket.id || match.black === socket.id) {
        const opponentId = match.white === socket.id ? match.black : match.white;
        io.to(opponentId).emit('opponent_disconnected');

        // Clean up the match
        endMatch(matchId);
        break;
      }
    }

    users.delete(socket.id);
    broadcastLobby();
  });
});

function endMatch(matchId) {
  const match = matches.get(matchId);
  if (!match) return;

  if (users.has(match.white)) users.get(match.white).status = 'lobby';
  if (users.has(match.black)) users.get(match.black).status = 'lobby';

  matches.delete(matchId);
  broadcastLobby();
}

// Broadcast the current lobby (only 'lobby' status users) to all connected clients
function broadcastLobby() {
  const lobbyUsers = Array.from(users.values()).filter(u => u.status === 'lobby');
  // Each client will filter out themselves
  io.emit('online_users_list', lobbyUsers);
}

// ─── Start Server ─────────────────────────────────────────────────────────────
const net = require('net');

function findFreePort(port, cb) {
  const probe = net.createServer();
  probe.once('error', () => findFreePort(port + 1, cb));
  probe.once('listening', () => probe.close(() => cb(port)));
  probe.listen(port);
}

findFreePort(START_PORT, (port) => {
  server.listen(port, () => {
    console.log(`\n==================================================`);
    console.log(`♟️  YayChess running with Socket.io!`);
    console.log(`👉 http://localhost:${port}`);
    console.log(`==================================================\n`);
  });
});
