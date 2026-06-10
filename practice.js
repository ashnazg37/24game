import { getRandomSolvablePuzzle } from "./solver.js";

// ── STATE ──────────────────────────────────────────────────────
let timeLimit     = 60;
let timeLeft      = 60;
let elapsed       = 0;
let timerInterval = null;
let puzzleStart   = null;
let solved = 0, streak = 0, bestMs = null, totalMs = 0;

let cards       = [];
let selectedIdx = null;
let selectedOp  = null;
let cardHistory = [];

const OP_CALC = { "+": (a,b) => a+b, "−": (a,b) => a-b, "×": (a,b) => a*b, "÷": (a,b) => a/b };

// ── START ──────────────────────────────────────────────────────
document.getElementById("start-btn").addEventListener("click", () => {
  timeLimit = parseInt(document.getElementById("time-limit-select").value);
  document.getElementById("start-screen").style.display = "none";
  document.getElementById("game-screen").style.display  = "block";
  if (timeLimit === 0) document.getElementById("timer-fill").style.display = "none";
  nextPuzzle();
});

// ── PUZZLE ─────────────────────────────────────────────────────
function nextPuzzle() {
  clearInterval(timerInterval);
  const nums  = getRandomSolvablePuzzle();
  puzzleStart = Date.now();
  elapsed     = 0;
  clearError();
  hideFeedback();
  initCards(nums);
  if (timeLimit > 0) startCountdown();
  else               startStopwatch();
}

// ── TIMER ──────────────────────────────────────────────────────
function startCountdown() {
  timeLeft = timeLimit;
  paintTimer(timeLeft, timeLimit);
  timerInterval = setInterval(() => {
    timeLeft--;
    paintTimer(timeLeft, timeLimit);
    if (timeLeft <= 0) { clearInterval(timerInterval); onTimeout(); }
  }, 1000);
}
function startStopwatch() {
  document.getElementById("timer-seconds").textContent = "0";
  timerInterval = setInterval(() => {
    elapsed++;
    document.getElementById("timer-seconds").textContent = elapsed;
  }, 1000);
}
function paintTimer(left, total) {
  const pct = total > 0 ? (left / total) * 100 : 100;
  const col  = pct > 50 ? "var(--accent)" : pct > 25 ? "#fbbf24" : "var(--danger)";
  document.getElementById("timer-seconds").textContent    = left;
  document.getElementById("timer-seconds").style.color    = col;
  document.getElementById("timer-fill").style.width           = pct + "%";
  document.getElementById("timer-fill").style.backgroundColor = col;
}
function onTimeout() {
  streak = 0;
  showFeedback("⏱ Time's up!", "timeout");
  updateStats();
  setTimeout(nextPuzzle, 1800);
}

// ── CARDS ──────────────────────────────────────────────────────
function initCards(numbers) {
  cards       = numbers.map((n) => ({ value: n, expr: String(n), used: false, isResult: false }));
  selectedIdx = null;
  selectedOp  = null;
  cardHistory = [];
  renderCards();
}

function renderCards() {
  const grid = document.getElementById("card-grid");
  const hint = document.getElementById("card-hint");
  grid.innerHTML = "";

  cards.forEach((card, i) => {
    const div = document.createElement("div");
    div.className = "num-card";

    if (card.used) {
      div.classList.add("num-card-empty");

    } else if (i === selectedIdx && selectedOp === null) {
      // Show 4 operator quadrants
      div.classList.add("num-card-ops");
      const og = document.createElement("div");
      og.className = "op-grid";
      ["+", "−", "×", "÷"].forEach(sym => {
        const b = document.createElement("button");
        b.className = "op-btn";
        b.textContent = sym;
        b.addEventListener("click", e => { e.stopPropagation(); selectOp(sym); });
        og.appendChild(b);
      });
      div.appendChild(og);
      // Tap card again to deselect
      div.addEventListener("click", () => { selectedIdx = null; selectedOp = null; renderCards(); });

    } else if (i === selectedIdx && selectedOp !== null) {
      // Pending — first operand locked in
      div.classList.add("num-card-pending");
      const numSpan = document.createElement("span");
      numSpan.textContent = fmt(card.value);
      const opSpan  = document.createElement("span");
      opSpan.className = "pending-op";
      opSpan.textContent = selectedOp;
      div.appendChild(numSpan);
      div.appendChild(opSpan);

    } else if (selectedOp !== null) {
      // Available as second operand — pulse
      div.classList.add("num-card-pick2");
      if (card.isResult) div.classList.add("num-card-result");
      div.textContent = fmt(card.value);
      div.addEventListener("click", () => combine(i));

    } else {
      // Normal idle
      div.classList.add(card.isResult ? "num-card-result" : "num-card-idle");
      div.textContent = fmt(card.value);
      div.addEventListener("click", () => { selectedIdx = i; selectedOp = null; clearError(); renderCards(); });
    }

    grid.appendChild(div);
  });

  if (hint) {
    if      (selectedIdx === null)   hint.textContent = "Pick a number";
    else if (selectedOp  === null)   hint.textContent = "Choose an operation";
    else                             hint.textContent = "Pick a second number";
  }
}

function selectOp(op) {
  selectedOp = op;
  renderCards();
}

function combine(bIdx) {
  if (selectedIdx === null || selectedOp === null || bIdx === selectedIdx) return;
  const a = cards[selectedIdx], b = cards[bIdx];
  if (selectedOp === "÷" && Math.abs(b.value) < 1e-12) { showError("Can't divide by zero"); return; }
  const result = OP_CALC[selectedOp](a.value, b.value);
  if (!isFinite(result)) { showError("Invalid"); return; }

  cardHistory.push(JSON.parse(JSON.stringify(cards)));
  cards[selectedIdx] = { value: result, expr: `(${a.expr} ${selectedOp} ${b.expr})`, used: false, isResult: true };
  cards[bIdx]        = { ...b, used: true };
  selectedIdx = null; selectedOp = null;
  clearError();

  const remaining = cards.filter(c => !c.used);
  if (remaining.length === 1) checkWin(remaining[0]);
  else renderCards();
}

function checkWin(card) {
  if (Math.abs(card.value - 24) < 1e-9) {
    clearInterval(timerInterval);
    const ms = Date.now() - puzzleStart;
    solved++; streak++; totalMs += ms;
    if (bestMs === null || ms < bestMs) bestMs = ms;
    showFeedback(`✓ Solved in ${(ms/1000).toFixed(1)}s`, "correct");
    updateStats();
    setTimeout(nextPuzzle, 1400);
  } else {
    renderCards();
    showError(`Result is ${fmt(card.value)}, not 24 — tap ↩ Undo`);
  }
}

// ── UNDO ───────────────────────────────────────────────────────
document.getElementById("undo-btn").addEventListener("click", () => {
  if (!cardHistory.length) return;
  cards = cardHistory.pop();
  selectedIdx = null; selectedOp = null;
  clearError(); renderCards();
});

// ── SKIP ───────────────────────────────────────────────────────
document.getElementById("skip-btn").addEventListener("click", () => {
  clearInterval(timerInterval);
  streak = 0;
  showFeedback("Skipped.", "wrong");
  updateStats();
  setTimeout(nextPuzzle, 1000);
});

// ── HELPERS ────────────────────────────────────────────────────
function fmt(v) {
  if (Number.isInteger(v)) return String(v);
  return String(parseFloat(v.toFixed(3)));
}
function updateStats() {
  document.getElementById("stat-solved").textContent = solved;
  document.getElementById("stat-streak").textContent = streak;
  if (bestMs  !== null) document.getElementById("stat-best").textContent = (bestMs/1000).toFixed(1) + "s";
  if (solved  > 0)      document.getElementById("stat-avg").textContent  = ((totalMs/solved)/1000).toFixed(1) + "s";
}
function showFeedback(msg, type) {
  const el = document.getElementById("feedback");
  el.textContent = msg; el.className = `feedback ${type}`;
}
function hideFeedback() {
  const el = document.getElementById("feedback");
  el.textContent = ""; el.className = "feedback hidden";
}
function showError(msg)  { const el = document.getElementById("input-error"); el.textContent = msg; el.style.display = "block"; }
function clearError()    { const el = document.getElementById("input-error"); el.textContent = ""; el.style.display = "none"; }