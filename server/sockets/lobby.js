const Room = require('../models/Room');
const { getRandomSolvablePuzzle } = require('../game/solver');

function serializeRoom(room) {
  const obj = room.toObject();
  // Convert Map fields to plain objects for JSON serialization
  obj.players   = Object.fromEntries(room.players);
  obj.rounds    = obj.rounds.map(r => ({
    ...r,
    skipVotes: r.skipVotes instanceof Map ? Object.fromEntries(r.skipVotes) : (r.skipVotes || {})
  }));
  return obj;
}

function registerLobby(socket, io) {
  const { googleId } = socket.user;

  socket.on('lobby:join', async (roomCode) => {
    if (typeof roomCode !== 'string') return;
    roomCode = roomCode.toUpperCase();

    const room = await Room.findOne({ roomCode });
    if (!room) { socket.emit('lobby:error', 'Room not found'); return; }
    if (!room.players.has(googleId)) { socket.emit('lobby:error', 'You are not in this room'); return; }

    socket.join(roomCode);

    // Mark player online
    room.players.get(googleId).online = true;
    room.markModified('players');
    await room.save();

    io.to(roomCode).emit('room:update', serializeRoom(room));
  });

  socket.on('lobby:start', async (roomCode) => {
    if (typeof roomCode !== 'string') return;
    roomCode = roomCode.toUpperCase();

    const room = await Room.findOne({ roomCode });
    if (!room)                                    { socket.emit('lobby:error', 'Room not found'); return; }
    if (room.meta.hostUid !== googleId)           { socket.emit('lobby:error', 'Only the host can start'); return; }
    if (room.meta.status !== 'lobby')             { socket.emit('lobby:error', 'Game already started'); return; }

    const numbers = getRandomSolvablePuzzle();
    room.meta.status       = 'active';
    room.meta.currentRound = 0;
    room.rounds.push({
      numbers,
      status:     'active',
      startedAt:  Date.now(),
      winnerId:   null,
      winnerName: null,
      solution:   null,
      skipVotes:  {}
    });

    await room.save();
    io.to(roomCode).emit('game:starting', { roomCode });
  });
}

// Called from server/index.js on socket disconnect
async function handleLobbyDisconnect(socket, io) {
  const { googleId } = socket.user;

  // Find all socket.io rooms this socket was in (excludes the socket's own room)
  for (const roomCode of socket.rooms) {
    if (roomCode === socket.id) continue; // skip the socket's own room

    try {
      const room = await Room.findOne({ roomCode });
      if (!room || !room.players.has(googleId)) continue;

      room.players.get(googleId).online = false;
      room.markModified('players');
      await room.save();

      io.to(roomCode).emit('room:update', serializeRoom(room));
    } catch (err) {
      console.error('[lobby disconnect] error:', err);
    }
  }
}

module.exports = { registerLobby, handleLobbyDisconnect };
