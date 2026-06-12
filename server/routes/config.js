const express = require('express');
const router = express.Router();

// GET /api/config
// Returns public client-side config. Not a secret — the Google Client ID
// is intentionally public (required by GIS to initialize the sign-in button).
router.get('/', (_req, res) => {
  res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID });
});

module.exports = router;
