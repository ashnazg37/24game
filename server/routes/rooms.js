const express = require('express');
const Room = require('../models/Room');
const User = require('../models/User');
const { verifyJWT } = require('../middleware/auth');
const { getRandomSolvablePuzzle } = require('../game/solver');

const router = express.Router();

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ2346789';

function generateCode() {
  let c = '';
  for (let i = 0; i < 6; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}

async function uniqueCode() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateCode();
    const exists = await Room.exists({ roomCode: code });
    if (!exists) return code;
  }
  throw new Error('Could not generate a unique room code');
}

// POST /api/rooms — create a custom lobby room
router.post('/', verifyJWT, async (req, res) => {
  let { totalRounds, skipMode, isRated } = req.body;

  totalRounds = parseInt(totalRounds, 10);
  if (!totalRounds || totalRounds < 1 || totalRounds > 50)
    return res.status(400).json({ error: 'totalRounds must be 1–50' });

  if (!['majority', 'unanimous'].includes(skipMode))
    return res.status(400).json({ error: 'skipMode must be majority or unanimous' });

  const user = await User.findById(req.user.userId).lean();
  if (!user) return res.status(401).json({ error: 'User not found' });

  let roomCode;
  try { roomCode = await uniqueCode(); }
  catch (e) { return res.status(500).json({ error: e.message }); }

  const room = new Room({
    roomCode,
    meta: {
      hostUid:  user.googleId,
      hostName: user.displayName,
      status:   'lobby',
      gameMode: 'room',
      isRated:  isRated !== false
    },
    settings: { totalRounds, skipMode },
    players: {
      [user.googleId]: {
        displayName:  user.username || user.displayName,
        photoURL:     user.photoURL || '',
        roomScore:    0,
        rating:       user.rating,
        online:       false,
        roundsPlayed: 0
      }
    }
  });

  await room.save();
  res.json({ roomCode });
});

// POST /api/rooms/:code/join — join an existing lobby room
router.post('/:code/join', verifyJWT, async (req, res) => {
  const code = req.params.code.toUpperCase();
  const room = await Room.findOne({ roomCode: code });

  if (!room)                          return res.status(404).json({ error: 'Room not found' });
  if (room.meta.status !== 'lobby')   return res.status(409).json({ error: 'Game has already started' });
  if (room.players.has(req.user.googleId)) return res.json({ ok: true }); // idempotent

  const user = await User.findById(req.user.userId).lean();
  if (!user) return res.status(401).json({ error: 'User not found' });

  room.players.set(req.user.googleId, {
    displayName:  user.username || user.displayName,
    photoURL:     user.photoURL || '',
    roomScore:    0,
    rating:       user.rating,
    online:       false,
    roundsPlayed: 0
  });

  await room.save();
  res.json({ ok: true });
});

module.exports = router;
