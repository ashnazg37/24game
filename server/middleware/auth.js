const jwt = require('jsonwebtoken');

// Express middleware: verifies Bearer token in Authorization header.
// Attaches req.user = { userId, googleId } on success.
function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.slice(7);
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET, { issuer: '24game' });
  } catch (err) {
    const msg = err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token';
    return res.status(401).json({ error: msg });
  }

  req.user = { userId: decoded.userId, googleId: decoded.googleId };
  next();
}

// Socket.io middleware: verifies token from socket.handshake.auth.token.
// Attaches socket.user = { userId, googleId } on success.
function verifySocketJWT(socket, next) {
  const token = socket.handshake.auth?.token;
  if (!token) {
    return next(new Error('No token provided'));
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET, { issuer: '24game' });
  } catch (err) {
    return next(new Error('Invalid token'));
  }

  socket.user = { userId: decoded.userId, googleId: decoded.googleId };
  next();
}

module.exports = { verifyJWT, verifySocketJWT };
