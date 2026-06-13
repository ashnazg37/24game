import { requireAuth, clearSession } from './session.js';
import { copyText } from './utils.js';

const session = requireAuth();
if (!session) throw new Error('redirecting');

const { token, user } = session;

document.getElementById('user-name').textContent = user.displayName;
document.getElementById('user-photo').src         = user.photoURL || '';

// ── SOCKET.IO ─────────────────────────────────────────────────────────────────
import { io } from '/socket.io/socket.io.esm.min.js';

const socket = io({ auth: { token } });

socket.on('connect_error', (err) => {
  console.error('[socket] connect error:', err.message);
  if (err.message === 'Invalid token' || err.message === 'Token expired') {
    clearSession();
    window.location.href = 'index.html';
  }
});

socket.on('queue:count', (count) => {
  const el = document.getElementById('waiting-count');
  if (!el) return;
  if (count === 0)      el.textContent = 'No one waiting yet';
  else if (count === 1) el.textContent = '1 player waiting for a match';
  else                  el.textContent = `${count} players waiting for a match`;
});

socket.on('queue:matched', ({ roomCode }) => {
  cleanup();
  window.location.href = `game.html?room=${roomCode}`;
});

// ── SIGN OUT ──────────────────────────────────────────────────────────────────
document.getElementById('sign-out-btn').addEventListener('click', () => {
  socket.disconnect();
  clearSession();
  window.location.href = 'index.html';
});

// ── CLIPBOARD ─────────────────────────────────────────────────────────────────
document.getElementById('copy-invite-btn').addEventListener('click', () => {
  copyText(window.location.origin, document.getElementById('copy-invite-btn'), 'Copy invite link');
});

// ── CREATE ROOM ───────────────────────────────────────────────────────────────
document.getElementById('create-btn').addEventListener('click', async () => {
  const totalRounds = parseInt(document.getElementById('total-rounds').value) || 10;
  const skipMode    = document.getElementById('skip-mode').value;

  try {
    const isRated = document.getElementById('rated-room').checked;
    const res = await fetch('/api/rooms', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body:    JSON.stringify({ totalRounds, skipMode, isRated })
    });
    const data = await res.json();
    if (!res.ok) { showError(data.error || 'Could not create room'); return; }
    window.location.href = `lobby.html?room=${data.roomCode}`;
  } catch {
    showError('Network error — could not create room');
  }
});

// ── JOIN ROOM ─────────────────────────────────────────────────────────────────
document.getElementById('join-btn').addEventListener('click', async () => {
  const code = document.getElementById('join-input').value.trim().toUpperCase();
  if (code.length !== 6) { showError('Room codes are 6 characters.'); return; }

  try {
    const res = await fetch(`/api/rooms/${code}/join`, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) { showError(data.error || 'Could not join room'); return; }
    window.location.href = `lobby.html?room=${code}`;
  } catch {
    showError('Network error — could not join room');
  }
});

// ── 1v1 MATCHMAKING ───────────────────────────────────────────────────────────
document.getElementById('find-btn').addEventListener('click', startSeek);
document.getElementById('cancel-btn').addEventListener('click', cancelSeek);

let dotsTimer = null;

function showSearching(on) {
  document.getElementById('idle-state').classList.toggle('hidden', on);
  document.getElementById('searching-state').classList.toggle('visible', on);
  if (on) {
    let n = 3;
    dotsTimer = setInterval(() => {
      n = (n % 3) + 1;
      document.getElementById('dots').textContent = '.'.repeat(n);
    }, 500);
  } else {
    clearInterval(dotsTimer);
    dotsTimer = null;
  }
}

function startSeek() {
  const isRated = document.getElementById('rated-1v1').checked;
  showSearching(true);
  socket.emit('queue:join', { isRated });
}

function cancelSeek() {
  socket.emit('queue:leave');
  cleanup();
}

function cleanup() {
  showSearching(false);
}

function showError(msg) {
  const el = document.getElementById('error-msg');
  el.textContent = msg;
  el.style.display = 'block';
}

// Update room code preview (now server-generated; show placeholder)
const previewEl = document.getElementById('preview-code');
if (previewEl) previewEl.textContent = '——————';

// Remove copy-room-link-btn since there's no pre-generated code to share
// (user creates the room first, then shares from lobby)
const copyRoomLinkBtn = document.getElementById('copy-room-link-btn');
if (copyRoomLinkBtn) copyRoomLinkBtn.style.display = 'none';
