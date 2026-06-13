const express = require('express');
const User = require('../models/User');
const { verifyJWT } = require('../middleware/auth');

const router = express.Router();

// GET /api/players — competitive leaderboard (sorted by rating)
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

// GET /api/players/me — full profile for the authenticated user
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

// PATCH /api/players/me/practice — update practiceStats only when the new value is strictly better
// Body: { bestTimeMs?: number, bestStreak?: number }
router.patch('/me/practice', verifyJWT, async (req, res) => {
  const { bestTimeMs, bestStreak } = req.body;
  try {
    const user = await User.findById(req.user.userId).select('practiceStats');
    if (!user) return res.status(404).json({ error: 'User not found' });

    let changed = false;
    if (typeof bestTimeMs === 'number' && isFinite(bestTimeMs) && bestTimeMs > 0) {
      if (user.practiceStats.bestTimeMs === null || bestTimeMs < user.practiceStats.bestTimeMs) {
        user.practiceStats.bestTimeMs = bestTimeMs;
        changed = true;
      }
    }
    if (typeof bestStreak === 'number' && Number.isInteger(bestStreak) && bestStreak > 0) {
      if (bestStreak > user.practiceStats.bestStreak) {
        user.practiceStats.bestStreak = bestStreak;
        changed = true;
      }
    }

    if (changed) await user.save();
    res.json({ practiceStats: user.practiceStats });
  } catch (err) {
    console.error('PATCH /api/players/me/practice error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/players/practice — practice leaderboard (sorted by fastest best time)
router.get('/practice', verifyJWT, async (req, res) => {
  try {
    const players = await User
      .find({ 'practiceStats.bestTimeMs': { $ne: null } })
      .sort({ 'practiceStats.bestTimeMs': 1 })
      .select('googleId displayName photoURL practiceStats')
      .lean();
    res.json({ players });
  } catch (err) {
    console.error('GET /api/players/practice error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
