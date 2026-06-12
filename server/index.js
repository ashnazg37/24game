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
const { verifySocketJWT }  = require('./middleware/auth');
const { registerMatchmaking } = require('./sockets/matchmaking');
const { registerLobby, handleLobbyDisconnect } = require('./sockets/lobby');

const app    = express();
const server = http.createServer(app);

// In-memory matchmaking queue: Map<googleId, playerData>
const seekingQueue = new Map();

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

  // Send current queue size on connect so dashboards can show live count
  socket.emit('queue:count', seekingQueue.size);

  registerMatchmaking(socket, io, seekingQueue);
  registerLobby(socket, io);

  socket.on('disconnect', async (reason) => {
    console.log(`[socket] disconnected id=${socket.id} reason=${reason}`);

    // Remove from matchmaking queue if seeking
    if (seekingQueue.has(socket.user.googleId)) {
      seekingQueue.delete(socket.user.googleId);
      io.emit('queue:count', seekingQueue.size);
    }

    // Update lobby presence for any rooms this socket was in
    await handleLobbyDisconnect(socket, io);
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
