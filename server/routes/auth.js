const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { verifyJWT } = require('../middleware/auth');

const router = express.Router();

// Single OAuth2Client instance reused across all requests
let googleClient;
function getGoogleClient() {
  if (!googleClient) googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  return googleClient;
}

// POST /api/auth/google
// Body: { credential: <Google ID Token string> }
// Returns: { token: <JWT>, user: { displayName, photoURL, rating, wins, roundsPlayed } }
router.post('/google', async (req, res) => {
  const { credential } = req.body;

  if (!credential || typeof credential !== 'string') {
    return res.status(400).json({ error: 'Missing credential' });
  }

  // 1. Verify the Google ID token (checks signature, expiry, issuer, audience)
  let payload;
  try {
    const ticket = await getGoogleClient().verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    payload = ticket.getPayload();
  } catch {
    return res.status(401).json({ error: 'Invalid Google token' });
  }

  const { sub: googleId, name: displayName, picture: photoURL } = payload;

  // 2. Upsert user — $setOnInsert prevents overwriting rating/wins on re-login
  let user;
  try {
    user = await User.findOneAndUpdate(
      { googleId },
      {
        $set: { displayName, photoURL: photoURL || '' },
        $setOnInsert: { rating: 1200, wins: 0, roundsPlayed: 0 }
      },
      { upsert: true, new: true, runValidators: true }
    );
  } catch (err) {
    console.error('DB upsert error:', err);
    return res.status(500).json({ error: 'Database error' });
  }

  // 3. Sign a 7-day JWT
  const token = jwt.sign(
    { userId: user._id.toString(), googleId: user.googleId },
    process.env.JWT_SECRET,
    { expiresIn: '7d', issuer: '24game' }
  );

  return res.json({
    token,
    user: {
      googleId:    user.googleId,
      username:    user.username || null,
      hasUsername: !!user.username,
      displayName: user.displayName,
      photoURL:    user.photoURL,
      rating:      user.rating,
      wins:        user.wins,
      roundsPlayed: user.roundsPlayed
    }
  });
});

// POST /api/auth/google-redirect
// Called by Google after GIS redirect-mode sign-in.
// Google sends credential as application/x-www-form-urlencoded, not JSON.
router.post('/google-redirect', express.urlencoded({ extended: false }), async (req, res) => {
  const { credential, g_csrf_token } = req.body;

  // CSRF check: Google sets g_csrf_token as a cookie AND sends it in the body.
  // Both must match.
  const cookieHeader = req.headers.cookie || '';
  const cookieCsrfMatch = cookieHeader.match(/g_csrf_token=([^;]+)/);
  const cookieCsrf = cookieCsrfMatch ? decodeURIComponent(cookieCsrfMatch[1]) : null;
  if (!g_csrf_token || !cookieCsrf || g_csrf_token !== cookieCsrf) {
    return res.status(403).send('CSRF verification failed');
  }

  if (!credential) return res.status(400).send('Missing credential');

  let payload;
  try {
    const ticket = await getGoogleClient().verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    payload = ticket.getPayload();
  } catch {
    return res.status(401).send('Invalid Google token');
  }

  const { sub: googleId, name: displayName, picture: photoURL } = payload;

  let user;
  try {
    user = await User.findOneAndUpdate(
      { googleId },
      {
        $set: { displayName, photoURL: photoURL || '' },
        $setOnInsert: { rating: 1200, wins: 0, roundsPlayed: 0 }
      },
      { upsert: true, new: true, runValidators: true }
    );
  } catch {
    return res.status(500).send('Database error');
  }

  const token = jwt.sign(
    { userId: user._id.toString(), googleId: user.googleId },
    process.env.JWT_SECRET,
    { expiresIn: '7d', issuer: '24game' }
  );

  // Encode session data as base64 to safely embed in HTML without XSS risk
  const sessionPayload = Buffer.from(JSON.stringify({
    token,
    user: {
      googleId:     user.googleId,
      username:     user.username || null,
      hasUsername:  !!user.username,
      displayName:  user.displayName,
      photoURL:     user.photoURL,
      rating:       user.rating,
      wins:         user.wins,
      roundsPlayed: user.roundsPlayed
    }
  })).toString('base64');

  // Return a minimal page that stores the JWT and redirects to the app.
  // Using base64 avoids any HTML/script injection from user-supplied fields.
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Signing in…</title></head><body>
<p style="font-family:sans-serif;text-align:center;padding-top:60px;color:#888;">Signing in…</p>
<script type="module">
const d = JSON.parse(atob('${sessionPayload}'));
localStorage.setItem('24game_token', d.token);
localStorage.setItem('24game_user', JSON.stringify(d.user));
if (!d.user.hasUsername) {
  window.location.replace('/username.html');
} else {
  const redirect = sessionStorage.getItem('redirectAfterLogin');
  sessionStorage.removeItem('redirectAfterLogin');
  window.location.replace(redirect && redirect.startsWith('/') ? redirect : '/dashboard.html');
}
</script>
</body></html>`);
});

// PATCH /api/auth/username — set username for the first time
router.patch('/username', verifyJWT, async (req, res) => {
  const { username } = req.body;
  if (!username || typeof username !== 'string') {
    return res.status(400).json({ error: 'Missing username' });
  }
  const normalized = username.toLowerCase().trim();
  if (!/^[a-z0-9_-]{3,20}$/.test(normalized)) {
    return res.status(400).json({ error: 'Username must be 3-20 chars: letters, numbers, _ or -' });
  }

  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.username) {
      return res.status(409).json({ error: 'Username already set' });
    }

    const taken = await User.findOne({ username: normalized });
    if (taken) {
      return res.status(409).json({ error: 'Username taken' });
    }

    user.username = normalized;
    await user.save();
    return res.json({ username: user.username });
  } catch (err) {
    console.error('PATCH /api/auth/username error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/auth/check-username/:name — check if a username is available
router.get('/check-username/:name', verifyJWT, async (req, res) => {
  const name = req.params.name.toLowerCase().trim();
  if (!/^[a-z0-9_-]{3,20}$/.test(name)) {
    return res.status(400).json({ error: 'Invalid username format' });
  }
  try {
    const taken = await User.findOne({ username: name }).lean();
    return res.json({ available: !taken });
  } catch (err) {
    console.error('GET /api/auth/check-username error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
