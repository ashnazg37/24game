const Room = require('../models/Room');
const User = require('../models/User');
const { getRandomSolvablePuzzle } = require('../game/solver');

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ2346789';

function generateCode() {
  let c = '';
  for (let i = 0; i < 6; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}

async function uniqueCode() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateCode();
    if (!(await Room.exists({ roomCode: code }))) return code;
  }
  throw new Error('Could not generate a unique room code');
}

async function createMatch(playerA, playerB) {
  const roomCode = await uniqueCode();
  const numbers  = getRandomSolvablePuzzle();

  const room = new Room({
    roomCode,
    meta: {
      hostUid:  playerA.googleId,
      status:   'active',
      gameMode: '1v1',
      isRated:  true,
      currentRound: 0,
      createdAt: Date.now()
    },
    settings: { totalRounds: 3, skipMode: 'unanimous' },
    players: {
      [playerA.googleId]: {
        displayName:  playerA.displayName,
        photoURL:     playerA.photoURL || '',
        roomScore:    0,
        rating:       playerA.rating,
        online:       true,
        roundsPlayed: 0
      },
      [playerB.googleId]: {
        displayName:  playerB.displayName,
        photoURL:     playerB.photoURL || '',
        roomScore:    0,
        rating:       playerB.rating,
        online:       true,
        roundsPlayed: 0
      }
    },
    rounds: [{
      numbers,
      status:     'active',
      startedAt:  Date.now(),
      winnerId:   null,
      winnerName: null,
      solution:   null,
      skipVotes:  {}
    }]
  });

  await room.save();
  return roomCode;
}

function registerMatchmaking(socket, io, seekingQueue) {
  const { googleId, userId } = socket.user;

  socket.on('queue:join', async () => {
    if (seekingQueue.has(googleId)) return; // already in queue

    let user;
    try {
      user = await User.findById(userId).lean();
    } catch { return; }
    if (!user) return;

    seekingQueue.set(googleId, {
      googleId,
      userId,
      displayName: user.displayName,
      photoURL:    user.photoURL || '',
      rating:      user.rating,
      socketId:    socket.id
    });

    io.emit('queue:count', seekingQueue.size);

    // Try to match the first two players in the queue
    if (seekingQueue.size < 2) return;

    const entries = [...seekingQueue.values()];
    const playerA = entries[0];
    const playerB = entries[1];

    // Remove both before async room creation to prevent double-match
    seekingQueue.delete(playerA.googleId);
    seekingQueue.delete(playerB.googleId);
    io.emit('queue:count', seekingQueue.size);

    let roomCode;
    try {
      roomCode = await createMatch(playerA, playerB);
    } catch (err) {
      console.error('[matchmaking] createMatch failed:', err);
      // Re-queue both players on failure
      seekingQueue.set(playerA.googleId, playerA);
      seekingQueue.set(playerB.googleId, playerB);
      io.emit('queue:count', seekingQueue.size);
      return;
    }

    // Emit to each player's socket by socket ID
    io.to(playerA.socketId).emit('queue:matched', { roomCode });
    io.to(playerB.socketId).emit('queue:matched', { roomCode });
  });

  socket.on('queue:leave', () => {
    seekingQueue.delete(googleId);
    io.emit('queue:count', seekingQueue.size);
  });
}

module.exports = { registerMatchmaking };
