import { getRandomSolvablePuzzle, findSolution } from "./solver.js";

// Firebase — optional (practice works without sign-in)
let auth = null, db = null, currentUser = null;
try {
  const fc = await import("./firebase-config.js");
  auth = fc.auth; db = fc.db;
  const { onAuthStateChanged } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
  onAuthStateChanged(auth, (user) => { currentUser = user; if (user) loadPBs(); });
} catch (e) { console.warn("Firebase unavailable, practice mode works offline."); }

let timeLimit = 60, timeLeft = 60, elapsed = 0, timerInterval = null, puzzleStart = null;
let solved = 0, streak = 0, bestMs = null, totalMs = 0;
let currentNumbers = [];
let cards = [], selectedIdx = null, selectedOp = null, cardHistory = [];
const OPS = { "+": (a,b)=>a+b, "−": (a,b)=>a-b, "×": (a,b)=>a*b, "÷": (a,b)=>a/b };
function fmt(v) { return Number.isInteger(v) ? String(v) : String(parseFloat(v.toFixed(3))); }

// Load personal bests from Firebase
async function loadPBs() {
  if (!db || !currentUser) return;
  try {
    const { ref, get } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js");
    const snap = await get(ref(db, `players/${currentUser.uid}`));
    if (!snap.exists()) return;
    const d = snap.val();
    if (d.practiceBestTime) document.getElementById("pb-time").textContent = (d.practiceBestTime / 1000).toFixed(1) + "s";
    if (d.practiceBestStreak) document.getElementById("pb-streak").textContent = d.practiceBestStreak;
  } catch (e) { console.warn("Could not load PBs:", e); }
}

// Save personal bests to Firebase
async function savePBs() {
  if (!db || !currentUser) return;
  try {
    const { ref, get, update } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js");
    const snap = await get(ref(db, `players/${currentUser.uid}`));
    const existing = snap.exists() ? snap.val() : {};
    const updates = {};
    if (bestMs !== null && (existing.practiceBestTime == null || bestMs < existing.practiceBestTime)) {
      updates[`players/${currentUser.uid}/practiceBestTime`] = bestMs;
    }
    if (streak > 0 && (existing.practiceBestStreak == null || streak > existing.practiceBestStreak)) {
      updates[`players/${currentUser.uid}/practiceBestStreak`] = streak;
    }
    if (Object.keys(updates).length) await update(ref(db), updates);
  } catch (e) { console.warn("Could not save PBs:", e); }
}

// Start
document.getElementById("start-btn").addEventListener("click", () => {
  timeLimit = parseInt(document.getElementById("time-limit-select").value);
  document.getElementById("start-screen").style.display = "none";
  document.getElementById("game-screen").style.display = "block";
  if (timeLimit === 0) document.getElementById("timer-fill").style.display = "none";
  nextPuzzle();
});

function nextPuzzle() {
  clearInterval(timerInterval);
  currentNumbers = getRandomSolvablePuzzle();
  cards = currentNumbers.map(n => ({ value: n, expr: String(n), used: false, isResult: false }));
  selectedIdx = null; selectedOp = null; cardHistory = [];
  puzzleStart = Date.now(); elapsed = 0;
  clearErr(); hideFeedback(); renderCards();
  if (timeLimit > 0) startCountdown(); else startStopwatch();
}

// Timer
function startCountdown() {
  timeLeft = timeLimit; paint(timeLeft, timeLimit);
  timerInterval = setInterval(() => {
    timeLeft--; paint(timeLeft, timeLimit);
    if (timeLeft <= 0) { clearInterval(timerInterval); onTimeout(); }
  }, 1000);
}
function startStopwatch() {
  document.getElementById("timer-seconds").textContent = "0";
  timerInterval = setInterval(() => { elapsed++; document.getElementById("timer-seconds").textContent = elapsed; }, 1000);
}
function paint(left, total) {
  const pct = total > 0 ? (left / total) * 100 : 100;
  const col = pct > 50 ? "var(--accent)" : pct > 25 ? "#fbbf24" : "var(--danger)";
  document.getElementById("timer-seconds").textContent = left;
  document.getElementById("timer-seconds").style.color = col;
  document.getElementById("timer-fill").style.width = pct + "%";
  document.getElementById("timer-fill").style.backgroundColor = col;
}

function onTimeout() {
  streak = 0;
  const sol = findSolution(currentNumbers);
  const solText = sol ? `<span class="solution-reveal">${sol}</span>` : "";
  showFeedback(`⏱ Time's up!${solText}`, "timeout");
  updateStats(); savePBs(); setTimeout(nextPuzzle, 2800);
}

// Card rendering — hardcoded hex, clamp() fonts, aspect-ratio grid
function renderCards() {
  const grid = document.getElementById("card-grid");
  if (!grid) return;
  const exprEl = document.getElementById("expr-display");
  if (exprEl) {
    const rc = cards.filter(c => !c.used && c.isResult);
    let d = "";
    if (selectedIdx !== null && selectedOp !== null) d = `${cards[selectedIdx].expr} ${selectedOp} …`;
    else if (selectedIdx !== null) d = cards[selectedIdx].expr;
    else if (rc.length) d = rc[rc.length - 1].expr;
    exprEl.textContent = d;
  }
  grid.style.cssText = "display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:10px;width:100%;margin-bottom:12px;aspect-ratio:1/1;max-height:340px;";
  grid.innerHTML = "";
  const B = "box-sizing:border-box;border-radius:12px;display:flex;align-items:center;justify-content:center;cursor:pointer;user-select:none;-webkit-user-select:none;font-family:'Bebas Neue',sans-serif;overflow:hidden;transition:opacity 0.15s,transform 0.1s;touch-action:manipulation;";
  const idle = r => r
    ? B + "background:#1a1040;color:#a5b4fc;border:2px solid #818cf8;font-size:clamp(1.8rem,6vw,2.4rem);"
    : B + "background:#0d3d48;color:#67e8f9;border:2px solid #67e8f9;font-size:clamp(2rem,7vw,2.8rem);";

  cards.forEach((card, i) => {
    const div = document.createElement("div");
    if (card.used) {
      div.style.cssText = B + "background:#111;border:2px dashed #333;cursor:default;opacity:0.3;";
    } else if (i === selectedIdx && selectedOp === null) {
      div.style.cssText = B + "background:#1a1a2e;border:2px solid #818cf8;cursor:default;padding:0;";
      const og = document.createElement("div");
      og.style.cssText = "display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;width:100%;height:100%;";
      ["+","−","×","÷"].forEach((sym, idx) => {
        const b = document.createElement("button");
        b.style.cssText = "border:none;background:transparent;font-size:clamp(1.4rem,5vw,2rem);font-family:'Bebas Neue',sans-serif;cursor:pointer;color:#aaa;display:flex;align-items:center;justify-content:center;touch-action:manipulation;";
        if (idx === 0) { b.style.borderRight = "1px solid #333"; b.style.borderBottom = "1px solid #333"; }
        if (idx === 1) b.style.borderBottom = "1px solid #333";
        if (idx === 2) b.style.borderRight = "1px solid #333";
        b.textContent = sym;
        b.onmouseenter = () => { b.style.background = "rgba(129,140,248,0.2)"; b.style.color = "#a5b4fc"; };
        b.onmouseleave = () => { b.style.background = "transparent"; b.style.color = "#aaa"; };
        b.onclick = e => { e.stopPropagation(); selectedOp = sym; renderCards(); };
        og.appendChild(b);
      });
      div.appendChild(og);
      div.onclick = () => { selectedIdx = null; selectedOp = null; renderCards(); };
    } else if (i === selectedIdx && selectedOp !== null) {
      div.style.cssText = B + "background:#1a1040;color:#a5b4fc;border:2px solid #818cf8;flex-direction:column;gap:4px;font-size:clamp(1.6rem,5vw,2.2rem);";
      const ns = document.createElement("span"); ns.textContent = fmt(card.value);
      const os = document.createElement("span"); os.style.cssText = "font-family:'Space Mono',monospace;font-size:0.8rem;opacity:0.65;"; os.textContent = selectedOp;
      div.appendChild(ns); div.appendChild(os);
    } else if (selectedOp !== null) {
      div.style.cssText = idle(card.isResult) + "box-shadow:0 0 20px rgba(103,232,249,0.4);";
      div.textContent = fmt(card.value);
      div.onclick = () => combine(i);
    } else {
      div.style.cssText = idle(card.isResult);
      div.textContent = fmt(card.value);
      div.onclick = () => { selectedIdx = i; selectedOp = null; clearErr(); renderCards(); };
    }
    grid.appendChild(div);
  });
  const hint = document.getElementById("card-hint");
  if (hint) {
    if (selectedIdx === null) hint.textContent = "Pick a number";
    else if (selectedOp === null) hint.textContent = "Choose an operation";
    else hint.textContent = "Pick a second number";
  }
}

// Combine
function combine(bIdx) {
  if (selectedIdx === null || selectedOp === null || bIdx === selectedIdx) return;
  const a = cards[selectedIdx], b = cards[bIdx];
  if (selectedOp === "÷" && Math.abs(b.value) < 1e-12) { showErr("Can't divide by zero"); return; }
  const result = OPS[selectedOp](a.value, b.value);
  if (!isFinite(result)) { showErr("Invalid"); return; }
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
    showFeedback(`✓ Solved in ${(ms / 1000).toFixed(1)}s`, "correct");
    updateStats(); savePBs(); setTimeout(nextPuzzle, 1400);
  } else {
    renderCards(); showErr(`= ${fmt(card.value)}, not 24 — tap ↩ Undo`);
  }
}

// Undo / Skip
document.getElementById("undo-btn").addEventListener("click", () => {
  if (!cardHistory.length) return;
  cards = cardHistory.pop(); selectedIdx = null; selectedOp = null; clearErr(); renderCards();
});
document.getElementById("skip-btn").addEventListener("click", () => {
  clearInterval(timerInterval);
  streak = 0;
  const sol = findSolution(currentNumbers);
  const solText = sol ? `<span class="solution-reveal">${sol}</span>` : "";
  showFeedback(`Skipped${solText}`, "wrong");
  updateStats(); savePBs(); setTimeout(nextPuzzle, 2400);
});

// Stats
function updateStats() {
  document.getElementById("stat-solved").textContent = solved;
  document.getElementById("stat-streak").textContent = streak;
  if (bestMs !== null) document.getElementById("stat-best").textContent = (bestMs / 1000).toFixed(1) + "s";
  if (solved > 0) document.getElementById("stat-avg").textContent = ((totalMs / solved) / 1000).toFixed(1) + "s";
}
function showFeedback(msg, type) { const el = document.getElementById("feedback"); el.innerHTML = msg; el.className = `feedback ${type}`; }
function hideFeedback() { const el = document.getElementById("feedback"); el.innerHTML = ""; el.className = "feedback hidden"; }
function showErr(msg) { const el = document.getElementById("input-error"); el.textContent = msg; el.style.display = "block"; }
function clearErr() { const el = document.getElementById("input-error"); el.textContent = ""; el.style.display = "none"; }