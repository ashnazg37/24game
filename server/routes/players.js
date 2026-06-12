const express = require('express');
const User = require('../models/User');
const { verifyJWT } = require('../middleware/auth');

const router = express.Router();

// GET /api/players
// Returns all players with at least one round played, sorted by rating.
// Used by leaderboard.js (Phase 2 will wire the frontend to this endpoint).
router.get('/', verifyJWT, async (req, res) => {
  try {
    const players = await User
      .find({ roundsPlayed: { $gt: 0 } })
      .sort({ rating: -1 })
      .select('googleId displayName photoURL rating wins roundsPlayed practiceStats')
      .lean();
    res.json({ players });
  } catch (err) {
    console.error('GET /api/players error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/players/me
// Returns the authenticated user's full profile (including practiceStats).
router.get('/me', verifyJWT, async (req, res) => {
  try {
    const user = await User
      .findById(req.user.userId)
      .select('googleId displayName photoURL rating wins roundsPlayed practiceStats')
      .lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) {
    console.error('GET /api/players/me error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
