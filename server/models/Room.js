const mongoose = require('mongoose');

// Mirrors Firebase: rooms/{roomCode}/players/{uid}
const roomPlayerSchema = new mongoose.Schema(
  {
    displayName:  { type: String, required: true },
    photoURL:     { type: String, default: '' },
    roomScore:    { type: Number, default: 0 },
    rating:       { type: Number, default: 1200 },
    online:       { type: Boolean, default: false },
    roundsPlayed: { type: Number, default: 0 }
  },
  { _id: false }
);

// Mirrors Firebase: rooms/{roomCode}/rounds/{index}
const roundSchema = new mongoose.Schema(
  {
    numbers:    { type: [Number], required: true },
    status:     { type: String, enum: ['active', 'solved', 'skipped'], default: 'active' },
    startedAt:  { type: Number },
    solvedAt:   { type: Number, default: null },
    winnerId:   { type: String, default: null },
    winnerName: { type: String, default: null },
    solution:   { type: String, default: null },
    // Map key = googleId string, value = true (mirrors Firebase skipVotes/{uid: true})
    skipVotes:  { type: Map, of: Boolean, default: () => ({}) }
  },
  { _id: false }
);

const roomSchema = new mongoose.Schema(
  {
    roomCode: {
      type: String,
      required: true,
      unique: true,
      index: true,
      uppercase: true,
      minlength: 6,
      maxlength: 6
    },
    meta: {
      hostUid:       { type: String, required: true },
      hostName:      { type: String, default: '' },
      status:        { type: String, enum: ['lobby', 'active', 'finished', 'abandoned'], default: 'lobby' },
      currentRound:  { type: Number, default: 0 },
      createdAt:     { type: Number, default: () => Date.now() },
      gameMode:      { type: String, enum: ['1v1', 'room', null], default: null },
      isRated:       { type: Boolean, default: true },
      abandonedBy:   { type: String, default: null },
      abandonedName: { type: String, default: null }
    },
    settings: {
      totalRounds: { type: Number, default: 3 },
      skipMode:    { type: String, enum: ['majority', 'unanimous'], default: 'majority' }
    },
    // Map key = googleId string, value = roomPlayer sub-doc
    // Mirrors Firebase: rooms/{roomCode}/players/{uid}
    players: {
      type: Map,
      of: roomPlayerSchema,
      default: () => ({})
    },
    // Array indexed by round number (0-based), mirrors Firebase rounds/{index}
    rounds: { type: [roundSchema], default: [] },
    // Server-only: socket IDs currently in this room (not sent to clients)
    activeSocketIds: { type: [String], default: [] }
  },
  { timestamps: true }
);

// Auto-delete finished/abandoned rooms after 24 hours
roomSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model('Room', roomSchema);
