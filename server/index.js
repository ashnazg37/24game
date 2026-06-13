// Load .env from project root regardless of cwd
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors     = require('cors');
const helmet   = require('helmet');
const path     = require('path');

const authRoutes    = require('./routes/auth');
const playerRoutes  = require('./routes/players');
const configRoutes  = require('./routes/config');
const roomRoutes    = require('./routes/rooms');
const { verifySocketJWT }          = require('./middleware/auth');
const { registerMatchmaking }      = require('./sockets/matchmaking');
const { registerLobby, handleLobbyDisconnect } = require('./sockets/lobby');
const { registerGame, handleGameDisconnect }   = require('./sockets/game');

const app    = express();
const server = http.createServer(app);

// Separate queues so rated and unrated players only match each other
const ratedQueue   = new Map();
const unratedQueue = new Map();

// ── SOCKET.IO ─────────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST']
  }
});

io.use(verifySocketJWT);

io.on('connection', (socket) => {
  console.log(`[socket] connected  id=${socket.id} user=${socket.user?.googleId}`);

  socket.emit('queue:count', ratedQueue.size + unratedQueue.size);

  registerMatchmaking(socket, io, ratedQueue, unratedQueue);
  registerLobby(socket, io);
  registerGame(socket, io);

  socket.on('disconnect', async (reason) => {
    console.log(`[socket] disconnected id=${socket.id} reason=${reason}`);

    const { googleId } = socket.user;

    // Snapshot room codes before socket.rooms is potentially cleared
    const gameRooms = [...socket.rooms].filter(r => r !== socket.id);

    // Remove from matchmaking queues
    if (ratedQueue.has(googleId) || unratedQueue.has(googleId)) {
      ratedQueue.delete(googleId);
      unratedQueue.delete(googleId);
      io.emit('queue:count', ratedQueue.size + unratedQueue.size);
    }

    // Mark offline in any rooms (lobby + game pages)
    await handleLobbyDisconnect(socket, io);

    // Handle 1v1 game abandonment if the disconnected player was mid-game
    await handleGameDisconnect(socket, io, gameRooms);
  });
});

// ── EXPRESS MIDDLEWARE ────────────────────────────────────────────────────────
// CSP disabled: existing frontend HTML has inline <style> and <script> blocks
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

// ── API ROUTES ────────────────────────────────────────────────────────────────
app.use('/api/auth',    authRoutes);
app.use('/api/players', playerRoutes);
app.use('/api/config',  configRoutes);
app.use('/api/rooms',   roomRoutes);

// ── STATIC FILES ──────────────────────────────────────────────────────────────
const FRONTEND_ROOT = path.join(__dirname, '..');
app.use(express.static(FRONTEND_ROOT));

// SPA fallback — must come after static middleware and API routes
app.get('*', (_req, res) => {
  res.sendFile(path.join(FRONTEND_ROOT, 'index.html'));
});

// ── DATABASE + SERVER START ───────────────────────────────────────────────────
async function start() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set. Add it to your .env file.');
    process.exit(1);
  }

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    console.log('[db] MongoDB connected');
  } catch (err) {
    console.error('[db] MongoDB connection failed:', err.message);
    process.exit(1);
  }

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`[server] Running on http://localhost:${PORT}`);
  });
}

start();

module.exports = { io };
