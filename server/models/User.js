const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    googleId:     { type: String, required: true, unique: true, index: true },
    email:        { type: String, sparse: true, unique: true, trim: true, lowercase: true },
    username: {
      type: String,
      unique: true,
      sparse: true,    // allows multiple null/undefined while enforcing uniqueness for non-null
      minlength: 3,
      maxlength: 20,
      match: /^[a-z0-9_-]+$/,
      trim: true,
      lowercase: true
    },
    displayName:  { type: String, required: true },
    photoURL:     { type: String, default: '' },
    rating:       { type: Number, default: 1200 },
    wins:         { type: Number, default: 0 },
    roundsPlayed: { type: Number, default: 0 },
    // Phase 4: practice mode stats (included now to avoid a schema migration)
    practiceStats: {
      bestTimeMs: { type: Number, default: null },
      bestStreak: { type: Number, default: 0 }
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
