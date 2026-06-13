const Room = require('../models/Room');
const User = require('../models/User');
const { validateExpression }     = require('../game/validator');
const { getRandomSolvablePuzzle } = require('../game/solver');
const { calculateElo }           = require('../game/elo');
const { serializeRoom }          = require('../game/serialize');

// Per-room timers for 1v1 auto-advance after a round ends
const advanceTimers = new Map();

// ── Internal helpers ──────────────────────────────────────────────────────────

async function applyElo(room, winnerId) {
  const playerEntries = [...room.players.entries()];
  const ratings = {};
  await Promise.all(playerEntries.map(async ([uid]) => {
    const u = await User.findOne({ googleId: uid }).select('rating').lean();
    ratings[uid] = u?.rating ?? 1200;
  }));
  const changes = calculateElo(ratings, winnerId);
  await Promise.all(playerEntries.map(async ([uid]) => {
    const newRating = Math.max(100, (ratings[uid] ?? 1200) + (changes[uid] ?? 0));
    await User.findOneAndUpdate({ googleId: uid }, { $set: { rating: newRating } });
    if (room.players.has(uid)) room.players.get(uid).rating = newRating;
  }));
  room.markModified('players');
}

async function updateGlobalStats(room, winnerId) {
  const playerEntries = [...room.players.entries()];
  await Promise.all(playerEntries.map(async ([uid]) => {
    const inc = { roundsPlayed: 1 };
    if (uid === winnerId) inc.wins = 1;
    await User.findOneAndUpdate({ googleId: uid }, { $inc: inc });
  }));
}

async function advanceToNextRound(room, io) {
  const next = room.meta.currentRound + 1;
  if (next >= room.settings.totalRounds) {
    room.meta.status = 'finished';
  } else {
    room.meta.currentRound = next;
    room.rounds.push({
      numbers:   getRandomSolvablePuzzle(),
      status:    'active',
      startedAt: Date.now(),
      winnerId:  null, winnerName: null, solution: null,
      skipVotes: {}
    });
  }
  await room.save();
  io.to(room.roomCode).emit('room:update', serializeRoom(room));
}

function scheduleNextRound(roomCode, io) {
  const existing = advanceTimers.get(roomCode);
  if (existing) clearTimeout(existing);
  const handle = setTimeout(async () => {
    advanceTimers.delete(roomCode);
    try {
      const room = await Room.findOne({ roomCode });
      if (room && room.meta.status === 'active') await advanceToNextRound(room, io);
    } catch (err) {
      console.error('[game] scheduleNextRound error:', err);
    }
  }, 3000);
  advanceTimers.set(roomCode, handle);
}

function cancelNextRound(roomCode) {
  const existing = advanceTimers.get(roomCode);
  if (existing) { clearTimeout(existing); advanceTimers.delete(roomCode); }
}

// ── Disconnect handler (called from server/index.js on socket disconnect) ─────

async function handleGameDisconnect(socket, io, gameRooms) {
  const { googleId } = socket.user;
  for (const roomCode of gameRooms) {
    try {
      const room = await Room.findOne({ roomCode });
      if (!room || room.meta.status !== 'active' || room.meta.gameMode !== '1v1') continue;
      if (!room.players.has(googleId)) continue;

      // After handleLobbyDisconnect ran, the disconnecting player is already marked offline.
      // If exactly one player remains online, that player wins by abandonment.
      const onlinePlayers = [...room.players.entries()].filter(([, p]) => p.online);
      if (onlinePlayers.length !== 1) continue;

      const survivorId = onlinePlayers[0][0];

      cancelNextRound(roomCode);
      room.meta.status      = 'abandoned';
      room.meta.abandonedBy   = googleId;
      room.meta.abandonedName = room.players.get(googleId)?.displayName || 'Opponent';

      if (room.meta.isRated) {
        await applyElo(room, survivorId);
        await updateGlobalStats(room, survivorId);
      }

      await room.save();
      io.to(roomCode).emit('room:update', serializeRoom(room));
    } catch (err) {
      console.error('[game disconnect] error:', err);
    }
  }
}

// ── Socket event handlers ─────────────────────────────────────────────────────

function registerGame(socket, io) {
  const { googleId } = socket.user;

  // game:join — player arrives at game.html, joins the Socket.io room
  socket.on('game:join', async (roomCode) => {
    if (typeof roomCode !== 'string') return;
    roomCode = roomCode.toUpperCase();

    const room = await Room.findOne({ roomCode });
    if (!room) { socket.emit('game:error', 'Room not found'); return; }
    if (!room.players.has(googleId)) { socket.emit('game:error', 'Not a member of this room'); return; }

    socket.join(roomCode);
    room.players.get(googleId).online = true;
    room.markModified('players');
    await room.save();
    io.to(roomCode).emit('room:update', serializeRoom(room));
  });

  // game:submit — player claims to have solved the puzzle
  socket.on('game:submit', async ({ roomCode, solution }) => {
    if (typeof roomCode !== 'string' || typeof solution !== 'string') return;
    roomCode = roomCode.toUpperCase();

    const room = await Room.findOne({ roomCode });
    if (!room || room.meta.status !== 'active') return;
    if (!room.players.has(googleId)) return;

    const roundIdx = room.meta.currentRound;
    const round = room.rounds[roundIdx];
    if (!round || round.status !== 'active') return;

    const validation = validateExpression(solution, round.numbers);
    if (!validation.valid) {
      socket.emit('game:invalid', validation.message);
      return;
    }

    // Atomic update — only succeeds if the round is still active (prevents double-win)
    const atomicSet = {
      [`rounds.${roundIdx}.status`]:    'solved',
      [`rounds.${roundIdx}.winnerId`]:   googleId,
      [`rounds.${roundIdx}.winnerName`]: room.players.get(googleId)?.displayName || 'Unknown',
      [`rounds.${roundIdx}.solution`]:   solution,
      [`rounds.${roundIdx}.solvedAt`]:   Date.now()
    };

    const updated = await Room.findOneAndUpdate(
      { roomCode, [`rounds.${roundIdx}.status`]: 'active' },
      { $set: atomicSet, $inc: { [`players.${googleId}.roomScore`]: 1 } },
      { new: true }
    );
    if (!updated) return; // another player beat us to it

    // Check match-win threshold (1v1 only — room games play all rounds)
    if (updated.meta.gameMode === '1v1') {
      const winThreshold = Math.ceil(updated.settings.totalRounds / 2);
      const playerScore  = updated.players.get(googleId)?.roomScore ?? 0;

      if (playerScore >= winThreshold) {
        updated.meta.status = 'finished';
        if (updated.meta.isRated) {
          await applyElo(updated, googleId);
          await updateGlobalStats(updated, googleId);
        }
        await updated.save();
        io.to(roomCode).emit('room:update', serializeRoom(updated));
        return;
      }
      // Match not over yet — schedule auto-advance to next round
      io.to(roomCode).emit('room:update', serializeRoom(updated));
      scheduleNextRound(roomCode, io);
    } else {
      // Room mode — host manually advances rounds
      io.to(roomCode).emit('room:update', serializeRoom(updated));
    }
  });

  // game:skip — player votes to skip the current round
  socket.on('game:skip', async (roomCode) => {
    if (typeof roomCode !== 'string') return;
    roomCode = roomCode.toUpperCase();

    const room = await Room.findOne({ roomCode });
    if (!room || room.meta.status !== 'active') return;
    if (!room.players.has(googleId)) return;

    const roundIdx = room.meta.currentRound;
    const round = room.rounds[roundIdx];
    if (!round || round.status !== 'active') return;

    // Idempotent — ignore if already voted
    const alreadyVoted = round.skipVotes instanceof Map
      ? round.skipVotes.has(googleId)
      : !!(round.skipVotes?.[googleId]);
    if (alreadyVoted) return;

    // Add vote atomically
    const afterVote = await Room.findOneAndUpdate(
      { roomCode, [`rounds.${roundIdx}.status`]: 'active' },
      { $set: { [`rounds.${roundIdx}.skipVotes.${googleId}`]: true } },
      { new: true }
    );
    if (!afterVote) return; // round was solved/skipped concurrently

    const newRound    = afterVote.rounds[roundIdx];
    const onlineCount = [...afterVote.players.values()].filter(p => p.online).length || 1;
    const needed      = afterVote.settings.skipMode === 'unanimous'
      ? onlineCount
      : Math.ceil(onlineCount / 2);
    const votes = newRound.skipVotes instanceof Map
      ? newRound.skipVotes.size
      : Object.keys(newRound.skipVotes || {}).length;

    if (votes >= needed) {
      const afterSkip = await Room.findOneAndUpdate(
        { roomCode, [`rounds.${roundIdx}.status`]: 'active' },
        { $set: { [`rounds.${roundIdx}.status`]: 'skipped' } },
        { new: true }
      );
      const finalRoom = afterSkip || afterVote;
      io.to(roomCode).emit('room:update', serializeRoom(finalRoom));
      if (finalRoom.meta.gameMode === '1v1' && afterSkip) {
        scheduleNextRound(roomCode, io);
      }
    } else {
      io.to(roomCode).emit('room:update', serializeRoom(afterVote));
    }
  });

  // game:next-round — host manually advances in non-1v1 rooms
  socket.on('game:next-round', async (roomCode) => {
    if (typeof roomCode !== 'string') return;
    roomCode = roomCode.toUpperCase();

    const room = await Room.findOne({ roomCode });
    if (!room || room.meta.status !== 'active') return;
    if (room.meta.hostUid !== googleId) return;
    if (room.meta.gameMode === '1v1') return; // 1v1 auto-advances

    const round = room.rounds[room.meta.currentRound];
    if (!round || round.status === 'active') return; // can't advance mid-round

    await advanceToNextRound(room, io);
  });

  // game:resign — player voluntarily leaves or resigns
  socket.on('game:resign', async (roomCode) => {
    if (typeof roomCode !== 'string') return;
    roomCode = roomCode.toUpperCase();

    const room = await Room.findOne({ roomCode });
    if (!room || room.meta.status !== 'active') return;
    if (!room.players.has(googleId)) return;

    cancelNextRound(roomCode);

    room.meta.status      = 'abandoned';
    room.meta.abandonedBy   = googleId;
    room.meta.abandonedName = room.players.get(googleId)?.displayName || 'Unknown';
    room.players.get(googleId).online = false;
    room.markModified('players');

    if (room.meta.gameMode === '1v1' && room.meta.isRated) {
      const survivorEntry = [...room.players.entries()].find(([uid]) => uid !== googleId);
      if (survivorEntry) {
        await applyElo(room, survivorEntry[0]);
        await updateGlobalStats(room, survivorEntry[0]);
      }
    }

    await room.save();
    io.to(roomCode).emit('room:update', serializeRoom(room));
  });
}

module.exports = { registerGame, handleGameDisconnect };
