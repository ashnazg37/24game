import { getRandomSolvablePuzzle, getSolution } from './solver.js';
import { getSession } from './session.js';

// Optional auth — practice works for guests too
const session = getSession();
const token   = session?.token ?? null;

let timeLimit = 60, timeLeft = 60, elapsed = 0, timerInterval = null, puzzleStart = null, puzzleSolution = null;
let solved = 0, streak = 0, bestMs = null, totalMs = 0, maxStreak = 0;
let cards = [], selectedIdx = null, selectedOp = null, cardHistory = [];

// Personal bests loaded from server (null when guest or not yet fetched)
let serverBestMs     = null;
let serverBestStreak = 0;

const OPS = { '+': (a,b)=>a+b, '−': (a,b)=>a-b, '×': (a,b)=>a*b, '÷': (a,b)=>a/b };
function fmt(v) { return Number.isInteger(v) ? String(v) : String(parseFloat(v.toFixed(3))); }

// Load personal bests from server on page load (if signed in)
if (token) {
  fetch('/api/players/me', { headers: { Authorization: `Bearer ${token}` } })
    .then(r => r.json())
    .then(({ user }) => {
      if (user?.practiceStats) {
        serverBestMs     = user.practiceStats.bestTimeMs ?? null;
        serverBestStreak = user.practiceStats.bestStreak ?? 0;
        // Seed local bests so the stat box shows the stored record immediately
        if (serverBestMs !== null) { bestMs = serverBestMs; updateStats(); }
        if (serverBestStreak > 0)  { maxStreak = serverBestStreak; }
      }
    })
    .catch(() => {}); // non-fatal — just won't show stored bests on load
}

async function savePracticeStats(newBestMs, newBestStreak) {
  if (!token) return;
  const body = {};
  if (newBestMs     !== null) body.bestTimeMs  = newBestMs;
  if (newBestStreak > 0)     body.bestStreak  = newBestStreak;
  if (!Object.keys(body).length) return;
  try {
    const res = await fetch('/api/players/me/practice', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body:    JSON.stringify(body)
    });
    const data = await res.json();
    if (data.practiceStats) {
      serverBestMs     = data.practiceStats.bestTimeMs ?? null;
      serverBestStreak = data.practiceStats.bestStreak ?? 0;
    }
  } catch { /* non-fatal */ }
}

// ── START ─────────────────────────────────────────────────────
document.getElementById('start-btn').addEventListener('click', () => {
  timeLimit = parseInt(document.getElementById('time-limit-select').value);
  document.getElementById('start-screen').style.display = 'none';
  document.getElementById('game-screen').style.display  = 'block';
  if (timeLimit === 0) document.getElementById('timer-fill').style.display = 'none';
  nextPuzzle();
});

function nextPuzzle() {
  clearInterval(timerInterval);
  const numbers = getRandomSolvablePuzzle();
  puzzleSolution = getSolution(numbers);
  cards = numbers.map(n => ({ value: n, expr: String(n), used: false, isResult: false }));
  selectedIdx = null; selectedOp = null; cardHistory = [];
  puzzleStart = Date.now(); elapsed = 0;
  clearErr(); hideFeedback(); renderCards();
  if (timeLimit > 0) startCountdown(); else startStopwatch();
}

// ── TIMER ─────────────────────────────────────────────────────
function startCountdown() {
  timeLeft = timeLimit; paint(timeLeft, timeLimit);
  timerInterval = setInterval(() => {
    timeLeft--; paint(timeLeft, timeLimit);
    if (timeLeft <= 0) { clearInterval(timerInterval); onTimeout(); }
  }, 1000);
}

function startStopwatch() {
  document.getElementById('timer-seconds').textContent = '0';
  timerInterval = setInterval(() => {
    elapsed++;
    document.getElementById('timer-seconds').textContent = elapsed;
  }, 1000);
}

function paint(left, total) {
  const pct = total > 0 ? (left / total) * 100 : 100;
  const col  = pct > 50 ? 'var(--accent)' : pct > 25 ? '#fbbf24' : 'var(--danger)';
  document.getElementById('timer-seconds').textContent   = left;
  document.getElementById('timer-seconds').style.color   = col;
  document.getElementById('timer-fill').style.width           = pct + '%';
  document.getElementById('timer-fill').style.backgroundColor = col;
}

function onTimeout() {
  streak = 0;
  const answer = puzzleSolution ? ` Answer: ${puzzleSolution}` : '';
  showFeedback(`⏱ Time's up!${answer}`, 'timeout');
  updateStats();
  setTimeout(nextPuzzle, 2200);
}

// ── CARD RENDERING ────────────────────────────────────────────
function renderCards() {
  const grid = document.getElementById('card-grid');
  if (!grid) return;

  const exprEl = document.getElementById('expr-display');
  if (exprEl) {
    const resultCards = cards.filter(c => !c.used && c.isResult);
    let display = '';
    if      (selectedIdx !== null && selectedOp !== null) display = `${cards[selectedIdx].expr} ${selectedOp} …`;
    else if (selectedIdx !== null)                        display = cards[selectedIdx].expr;
    else if (resultCards.length > 0)                      display = resultCards[resultCards.length - 1].expr;
    exprEl.textContent = display;
  }

  grid.style.cssText =
    'display:grid;grid-template-columns:1fr 1fr;grid-template-rows:140px 140px;' +
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
      ['+', '−', '×', '÷'].forEach((sym, idx) => {
        const b = document.createElement('button');
        b.style.cssText =
          "border:none;background:transparent;font-size:2rem;font-family:'Bebas Neue',sans-serif;" +
          'cursor:pointer;color:#aaa;display:flex;align-items:center;justify-content:center;';
        const br = '1px solid #333';
        if (idx === 0) { b.style.borderRight = br; b.style.borderBottom = br; }
        if (idx === 1) b.style.borderBottom = br;
        if (idx === 2) b.style.borderRight  = br;
        b.textContent   = sym;
        b.onmouseenter  = () => { b.style.background = 'rgba(129,140,248,0.2)'; b.style.color = '#a5b4fc'; };
        b.onmouseleave  = () => { b.style.background = 'transparent'; b.style.color = '#aaa'; };
        b.onclick       = e => { e.stopPropagation(); selectedOp = sym; renderCards(); };
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
      div.textContent   = fmt(card.value);
      div.onclick       = () => combine(i);
      div.onmouseenter  = () => { div.style.transform = 'scale(1.04)'; };
      div.onmouseleave  = () => { div.style.transform = ''; };

    } else {
      div.style.cssText = idle(card.isResult);
      div.textContent   = fmt(card.value);
      div.onmouseenter  = () => { div.style.opacity = '0.8'; div.style.transform = 'translateY(-2px)'; };
      div.onmouseleave  = () => { div.style.opacity = '1'; div.style.transform = ''; };
      div.onclick       = () => { selectedIdx = i; selectedOp = null; clearErr(); renderCards(); };
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

// ── COMBINE / WIN ─────────────────────────────────────────────
function combine(bIdx) {
  if (selectedIdx === null || selectedOp === null || bIdx === selectedIdx) return;
  const a = cards[selectedIdx], b = cards[bIdx];
  if (selectedOp === '÷' && Math.abs(b.value) < 1e-12) { showErr("Can't divide by zero"); return; }
  const result = OPS[selectedOp](a.value, b.value);
  if (!isFinite(result)) { showErr('Invalid'); return; }
  cardHistory.push(JSON.parse(JSON.stringify(cards)));
  cards[selectedIdx] = { value: result, expr: `(${a.expr} ${selectedOp} ${b.expr})`, used: false, isResult: true };
  cards[bIdx] = { ...b, used: true };
  selectedIdx = null; selectedOp = null; clearErr();
  const rem = cards.filter(c => !c.used);
  if (rem.length === 1) checkWin(rem[0]); else renderCards();
}

function checkWin(card) {
  if (Math.abs(card.value - 24) < 1e-9) {
    clearInterval(timerInterval);
    const ms = Date.now() - puzzleStart;
    solved++; streak++; totalMs += ms;
    if (bestMs === null || ms < bestMs) bestMs = ms;
    if (streak > maxStreak) maxStreak = streak;

    // Determine what records were just broken
    const newTimePR   = (serverBestMs === null || ms < serverBestMs);
    const newStreakPR = (streak > serverBestStreak);

    let msg = `✓ Solved in ${(ms / 1000).toFixed(1)}s`;
    if (newTimePR && newStreakPR)   msg += ' 🏆 New time & streak records!';
    else if (newTimePR)             msg += ' 🏆 New best time!';
    else if (newStreakPR)           msg += ` 🔥 Streak record: ${streak}!`;

    showFeedback(msg, 'correct');
    updateStats();

    // Save to server if any personal record was broken
    savePracticeStats(
      newTimePR   ? ms      : null,
      newStreakPR ? streak  : 0
    );

    setTimeout(nextPuzzle, 1600);
  } else {
    renderCards();
    showErr(`Result is ${fmt(card.value)}, not 24 — ↩ Undo`);
  }
}

// ── UNDO / SKIP ───────────────────────────────────────────────
document.getElementById('undo-btn').addEventListener('click', () => {
  if (!cardHistory.length) return;
  cards = cardHistory.pop(); selectedIdx = null; selectedOp = null;
  clearErr(); renderCards();
});

document.getElementById('skip-btn').addEventListener('click', () => {
  clearInterval(timerInterval);
  streak = 0;
  const answer = puzzleSolution ? ` Answer: ${puzzleSolution}` : '';
  showFeedback(`Skipped.${answer}`, 'wrong');
  updateStats();
  setTimeout(nextPuzzle, 2200);
});

// ── STATS ─────────────────────────────────────────────────────
function updateStats() {
  document.getElementById('stat-solved').textContent = solved;
  document.getElementById('stat-streak').textContent = streak;
  if (bestMs !== null)
    document.getElementById('stat-best').textContent = (bestMs / 1000).toFixed(1) + 's';
  if (solved > 0)
    document.getElementById('stat-avg').textContent  = ((totalMs / solved) / 1000).toFixed(1) + 's';
}

// ── HELPERS ───────────────────────────────────────────────────
function showFeedback(msg, type) {
  const el = document.getElementById('feedback');
  el.textContent = msg;
  el.className   = `feedback ${type}`;
}
function hideFeedback() {
  const el = document.getElementById('feedback');
  el.textContent = '';
  el.className   = 'feedback hidden';
}
function showErr(msg)  { const el = document.getElementById('input-error'); el.textContent = msg; el.style.display = 'block'; }
function clearErr()    { const el = document.getElementById('input-error'); el.textContent = ''; el.style.display = 'none'; }
