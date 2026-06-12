import { requireAuth } from './session.js';
import { copyText } from './utils.js';

const roomCode = new URLSearchParams(window.location.search).get('room');
if (!roomCode) window.location.href = 'dashboard.html';

const session = requireAuth();
if (!session) throw new Error('redirecting');

const { token, user } = session;

document.getElementById('user-name').textContent         = user.displayName;
document.getElementById('user-photo').src                = user.photoURL || '';
document.getElementById('room-code-display').textContent = roomCode;

// ── SOCKET.IO ─────────────────────────────────────────────────────────────────
import { io } from '/socket.io/socket.io.esm.min.js';

const socket = io({ auth: { token } });

socket.on('connect', () => {
  socket.emit('lobby:join', roomCode);
});

socket.on('lobby:error', (msg) => {
  alert(msg);
  window.location.href = 'dashboard.html';
});

socket.on('room:update', (room) => {
  renderPlayers(room.players || {});
  const isHost = room.meta?.hostUid === user.googleId;
  document.getElementById('host-controls').style.display = isHost  ? 'block' : 'none';
  document.getElementById('waiting-msg').style.display   = !isHost ? 'block' : 'none';
});

socket.on('game:starting', () => {
  window.location.href = `game.html?room=${roomCode}`;
});

// ── HOST CONTROLS ─────────────────────────────────────────────────────────────
document.getElementById('start-btn').addEventListener('click', () => {
  socket.emit('lobby:start', roomCode);
});

// ── CLIPBOARD ─────────────────────────────────────────────────────────────────
document.getElementById('copy-room-link-btn').addEventListener('click', () => {
  const link = `${window.location.origin}/lobby.html?room=${roomCode}`;
  copyText(link, document.getElementById('copy-room-link-btn'), 'Copy link');
});

// ── RENDER ────────────────────────────────────────────────────────────────────
function renderPlayers(players) {
  const entries = Object.entries(players).filter(([, p]) => p.online);
  document.getElementById('player-list').innerHTML = entries.map(([, p]) => `
    <li class="player-item">
      <img src="${p.photoURL || ''}" style="width:32px;height:32px;border-radius:50%;" onerror="this.style.display='none'">
      <span>${p.displayName}</span>
      <span style="margin-left:auto;font-family:var(--font-mono);font-size:0.8rem;color:var(--muted);">${p.rating ?? 1200}</span>
    </li>
  `).join('');
  const n = entries.length;
  document.getElementById('player-count').textContent = `${n} player${n !== 1 ? 's' : ''} joined`;
}
