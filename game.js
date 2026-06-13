import { requireUsername, clearSession } from './session.js';
import { io } from '/socket.io/socket.io.esm.min.js';

const session = requireUsername();
if (!session) throw new Error('redirecting');
const { token, user } = session;

const roomCode = new URLSearchParams(window.location.search).get('room');
if (!roomCode) window.location.href = 'dashboard.html';

document.getElementById('user-photo').src        = user.photoURL || '';
document.getElementById('room-code-nav').textContent = roomCode;

let room = null, isHost = false;
let cards = [], selectedIdx = null, selectedOp = null, cardHistory = [];
let advanceDisplayTimer = null;

const OPS = { '+': (a,b)=>a+b, '−': (a,b)=>a-b, '×': (a,b)=>a*b, '÷': (a,b)=>a/b };

// ── Socket.io ─────────────────────────────────────────────────────────────────
const socket = io({ auth: { token } });

socket.on('connect', () => {
  socket.emit('game:join', roomCode);
});

socket.on('connect_error', (err) => {
  console.error('[socket] connect error:', err.message);
  if (err.message === 'Invalid token' || err.message === 'Token expired') {
    clearSession();
    window.location.href = 'index.html';
  }
});

socket.on('room:update', (updatedRoom) => {
  room = updatedRoom;
  try { renderGame(); } catch (err) { console.error('renderGame crashed:', err); }
});

socket.on('game:invalid', (msg) => {
  showInputError(msg || 'Invalid expression');
});

socket.on('game:error', (msg) => {
  console.error('[game:error]', msg);
  alert(msg);
  window.location.href = 'dashboard.html';
});

// ── Rendering ─────────────────────────────────────────────────────────────────
function renderGame() {
  if (!room || !room.meta) { setStatus('Loading...'); return; }

  isHost = room.meta.hostUid === user.googleId;
  const is1v1  = room.meta.gameMode === '1v1';
  const total  = room.settings?.totalRounds ?? 0;
  document.getElementById('round-display').textContent = `Round ${room.meta.currentRound + 1} / ${total}`;
  document.getElementById('resign-btn').textContent    = is1v1 ? 'Resign' : 'Leave Room';

  renderSidebars();

  if (room.meta.status === 'finished' || room.meta.status === 'abandoned') {
    showView('end-view'); renderEndScreen(); return;
  }
  if (room.meta.status === 'lobby') { setStatus('Waiting for game to start...'); return; }

  const round = currentRound();
  if (!round) { setStatus('Waiting for round data...'); return; }

  if (round.status === 'active') {
    showView('round-view');
    renderActiveRound(round);
  } else {
    showView('result-view');
    renderResult(round);
  }
}

function renderActiveRound(round) {
  clearInterval(advanceDisplayTimer);
  advanceDisplayTimer = null;
  document.getElementById('auto-advance-msg').style.display = 'none';

  const nums = Array.isArray(round.numbers) ? round.numbers : Object.values(round.numbers || {});
  if (!nums.length) { setStatus('Waiting for puzzle...'); return; }

  const numKey = nums.join(',') + '@' + room.meta.currentRound;
  if (window._lastNumKey !== numKey) {
    window._lastNumKey = numKey;
    cards = nums.map(n => ({ value: Number(n), expr: String(n), used: false, isResult: false }));
    selectedIdx = null; selectedOp = null; cardHistory = [];
    clearInputError();
  }
  renderCards();

  const onlineCount = Object.values(room.players || {}).filter(p => p.online).length || 1;
  const needed = room.settings?.skipMode === 'unanimous' ? onlineCount : Math.ceil(onlineCount / 2);
  const votes  = Object.keys(round.skipVotes || {}).length;
  document.getElementById('skip-count').textContent  = votes;
  document.getElementById('skip-needed').textContent = needed;
  document.getElementById('skip-btn').style.opacity  = round.skipVotes?.[user.googleId] ? '0.4' : '1';
}

function renderResult(round) {
  clearInterval(advanceDisplayTimer);
  advanceDisplayTimer = null;

  const el = document.getElementById('result-content');
  const solHtml = round.solution
    ? `<code class="result-solution">${round.solution}</code>`
    : '';
  if (round.status === 'solved')
    el.innerHTML = `<p class="result-winner">${round.winnerName} solved it!</p>${solHtml}`;
  else
    el.innerHTML = `<p class="result-skipped">Round skipped.</p>${solHtml}`;

  const is1v1 = room.meta.gameMode === '1v1';
  document.getElementById('next-round-btn').style.display   = (isHost && !is1v1) ? 'inline-block' : 'none';
  document.getElementById('waiting-for-host').style.display = (!isHost && !is1v1) ? 'block' : 'none';

  if (is1v1) {
    // Server auto-advances after 3s — show cosmetic countdown only
    const msg = document.getElementById('auto-advance-msg');
    msg.style.display = 'block';
    let n = 5;
    msg.textContent = `Next round in ${n}s`;
    advanceDisplayTimer = setInterval(() => {
      n--;
      if (n <= 0) { clearInterval(advanceDisplayTimer); advanceDisplayTimer = null; return; }
      msg.textContent = `Next round in ${n}s`;
    }, 1000);
  }
}

function renderEndScreen() {
  const isAb = room.meta.status === 'abandoned';
  document.getElementById('end-title').textContent = isAb ? 'Game Ended' : 'Game Over';
  const msg = document.getElementById('abandon-msg');
  if (isAb) {
    msg.textContent  = room.meta.abandonedBy === user.googleId
      ? 'You resigned.'
      : `${room.meta.abandonedName || 'Opponent'} left.`;
    msg.style.display = 'block';
  } else {
    msg.style.display = 'none';
  }
  document.getElementById('final-scores').innerHTML = Object.entries(room.players || {})
    .sort(([,a],[,b]) => b.roomScore - a.roomScore)
    .map(([uid, p], i) => `<div class="final-player ${uid === user.googleId ? 'is-you' : ''}">
      <span class="final-rank">#${i+1}</span>
      <img src="${p.photoURL||''}" onerror="this.style.display='none'" style="width:30px;height:30px;border-radius:50%;">
      <span class="final-name">${p.displayName}</span>
      <span class="final-score">${p.roomScore} wins</span></div>`).join('');
}

function renderSidebars() {
  const players = Object.entries(room.players || {}).filter(([,p]) => p.online);
  const is1v1   = room.meta.gameMode === '1v1';
  document.getElementById('room-leaderboard').innerHTML = [...players]
    .sort(([,a],[,b]) => b.roomScore - a.roomScore)
    .map(([uid, p]) => `<li class="player-item ${uid === user.googleId ? 'is-you' : ''}">
      <img src="${p.photoURL||''}" style="width:24px;height:24px;border-radius:50%;" onerror="this.style.display='none'">
      <span style="font-size:0.86rem;flex:1;">${p.displayName}</span>
      <span class="player-score">${p.roomScore}</span></li>`).join('');

  const eloSection = document.getElementById('elo-section');
  if (eloSection) eloSection.style.display = is1v1 ? 'block' : 'none';
  if (is1v1) {
    document.getElementById('elo-list').innerHTML = [...players]
      .sort(([,a],[,b]) => (b.rating??1200)-(a.rating??1200))
      .map(([uid, p]) => `<li class="player-item ${uid === user.googleId ? 'is-you' : ''}">
        <span style="font-size:0.86rem;flex:1;">${p.displayName}</span>
        <span class="player-score">${p.rating??1200}</span></li>`).join('');
  }
}

// ── Cards ─────────────────────────────────────────────────────────────────────
function renderCards() {
  const grid = document.getElementById('card-grid');
  if (!grid) return;

  grid.style.cssText =
    'display:grid;grid-template-columns:1fr 1fr;' +
    'gap:10px;width:100%;margin-bottom:12px;';
  grid.innerHTML = '';

  const BASE =
    'box-sizing:border-box;border-radius:12px;display:flex;align-items:center;' +
    'justify-content:center;cursor:pointer;user-select:none;-webkit-user-select:none;' +
    "font-family:'Bebas Neue',sans-serif;overflow:hidden;transition:opacity 0.15s,transform 0.1s;";

  const idle = r => r
    ? BASE + 'background:#1a1040;color:#a5b4fc;border:2px solid #818cf8;font-size:2.4rem;'
    : BASE + 'background:#0d3d48;color:#67e8f9;border:2px solid #67e8f9;font-size:2.8rem;';

  cards.forEach((card, i) => {
    const div = document.createElement('div');

    if (card.used) {
      div.style.cssText = BASE + 'background:#111;border:2px dashed #333;cursor:default;opacity:0.3;';

    } else if (i === selectedIdx && selectedOp === null) {
      div.style.cssText = BASE + 'background:#1a1a2e;border:2px solid #818cf8;cursor:default;padding:0;';
      const og = document.createElement('div');
      og.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;width:100%;height:100%;';
      ['+','−','×','÷'].forEach((sym, idx) => {
        const b = document.createElement('button');
        b.style.cssText =
          "border:none;background:transparent;font-size:2rem;font-family:'Bebas Neue',sans-serif;" +
          'cursor:pointer;color:#aaa;display:flex;align-items:center;justify-content:center;';
        const br = '1px solid #333';
        if (idx === 0) { b.style.borderRight = br; b.style.borderBottom = br; }
        if (idx === 1) b.style.borderBottom = br;
        if (idx === 2) b.style.borderRight  = br;
        b.textContent = sym;
        b.onmouseenter = () => { b.style.background = 'rgba(129,140,248,0.2)'; b.style.color = '#a5b4fc'; };
        b.onmouseleave = () => { b.style.background = 'transparent'; b.style.color = '#aaa'; };
        b.onclick = e => { e.stopPropagation(); selectedOp = sym; renderCards(); };
        og.appendChild(b);
      });
      div.appendChild(og);
      div.onclick = () => { selectedIdx = null; selectedOp = null; renderCards(); };

    } else if (i === selectedIdx && selectedOp !== null) {
      div.style.cssText = BASE + 'background:#1a1040;color:#a5b4fc;border:2px solid #818cf8;' +
        'flex-direction:column;gap:4px;font-size:2.2rem;';
      const ns = document.createElement('span'); ns.textContent = fmt(card.value);
      const os = document.createElement('span');
      os.style.cssText = "font-family:'Space Mono',monospace;font-size:0.85rem;opacity:0.65;";
      os.textContent = selectedOp;
      div.appendChild(ns); div.appendChild(os);

    } else if (selectedOp !== null) {
      div.style.cssText = idle(card.isResult) + 'box-shadow:0 0 20px rgba(103,232,249,0.4);';
      div.textContent = fmt(card.value);
      div.onclick = () => combine(i);
      div.onmouseenter = () => { div.style.transform = 'scale(1.04)'; };
      div.onmouseleave = () => { div.style.transform = ''; };

    } else {
      div.style.cssText = idle(card.isResult);
      div.textContent = fmt(card.value);
      div.onmouseenter = () => { div.style.opacity = '0.8'; div.style.transform = 'translateY(-2px)'; };
      div.onmouseleave = () => { div.style.opacity = '1'; div.style.transform = ''; };
      div.onclick = () => { selectedIdx = i; selectedOp = null; clearInputError(); renderCards(); };
    }

    grid.appendChild(div);
  });

  const hint = document.getElementById('card-hint');
  if (hint) {
    if      (selectedIdx === null) hint.textContent = 'Pick a number';
    else if (selectedOp  === null) hint.textContent = 'Choose an operation';
    else                           hint.textContent = 'Pick a second number';
  }
}

function combine(bIdx) {
  if (selectedIdx === null || selectedOp === null || bIdx === selectedIdx) return;
  const a = cards[selectedIdx], b = cards[bIdx];
  if (selectedOp === '÷' && Math.abs(b.value) < 1e-12) { showInputError("Can't divide by zero"); return; }
  const result = OPS[selectedOp](a.value, b.value);
  if (!isFinite(result)) { showInputError('Invalid'); return; }
  cardHistory.push(JSON.parse(JSON.stringify(cards)));
  cards[selectedIdx] = { value: result, expr: `(${a.expr} ${selectedOp} ${b.expr})`, used: false, isResult: true };
  cards[bIdx] = { ...b, used: true };
  selectedIdx = null; selectedOp = null; clearInputError();
  const rem = cards.filter(c => !c.used);
  if (rem.length === 1) checkWin(rem[0]); else renderCards();
}

function checkWin(card) {
  if (Math.abs(card.value - 24) < 1e-9) autoSubmit(card.expr);
  else { renderCards(); showInputError(`Result is ${fmt(card.value)}, not 24 — tap Undo`); }
}

document.getElementById('undo-btn').addEventListener('click', () => {
  if (!cardHistory.length) return;
  cards = cardHistory.pop(); selectedIdx = null; selectedOp = null;
  clearInputError(); renderCards();
});

// ── Game actions ──────────────────────────────────────────────────────────────
function autoSubmit(solution) {
  // Card UI uses Unicode operators; normalize to ASCII for server validation
  const normalized = solution.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
  socket.emit('game:submit', { roomCode, solution: normalized });
}

document.getElementById('skip-btn').addEventListener('click', () => {
  const round = currentRound();
  if (!round || round.status !== 'active' || round.skipVotes?.[user.googleId]) return;
  socket.emit('game:skip', roomCode);
});

document.getElementById('next-round-btn').addEventListener('click', () => {
  socket.emit('game:next-round', roomCode);
});

document.getElementById('resign-btn').addEventListener('click', () => {
  const is1v1 = room?.meta?.gameMode === '1v1';
  if (!confirm(is1v1 ? 'Resign? This counts as a loss.' : 'Leave this room?')) return;
  socket.emit('game:resign', roomCode);
  window.location.href = 'dashboard.html';
});

// ── Utilities ─────────────────────────────────────────────────────────────────
function currentRound() {
  if (!room?.rounds) return null;
  const idx = room.meta.currentRound;
  return Array.isArray(room.rounds) ? (room.rounds[idx] ?? null) : null;
}

function fmt(v) { return Number.isInteger(v) ? String(v) : String(parseFloat(v.toFixed(3))); }
function setStatus(msg) { const h = document.getElementById('card-hint'); if (h) h.textContent = msg; }
function showView(id) { ['round-view','result-view','end-view'].forEach(v => document.getElementById(v).style.display = v === id ? 'block' : 'none'); }
function showInputError(msg) { const el = document.getElementById('input-error'); el.textContent = msg; el.style.display = 'block'; }
function clearInputError()   { const el = document.getElementById('input-error'); el.textContent = ''; el.style.display = 'none'; }
