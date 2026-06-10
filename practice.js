import { validateExpression } from "./validator.js";
import { getRandomSolvablePuzzle } from "./solver.js";

// ── TIMER STATE ───────────────────────────────────────────────
let timeLimit     = 60;
let timeLeft      = 60;
let elapsed       = 0;
let timerInterval = null;
let puzzleStart   = null;

// Session stats
let solved = 0, streak = 0, bestMs = null, totalMs = 0;

// ── CARD STATE ────────────────────────────────────────────────
let cards        = [];
let selectedIdx  = null;
let selectedOp   = null;
let cardHistory  = [];
const OP_MAP = { "+": "+", "−": "-", "×": "*", "÷": "/" };

// ── START ──────────────────────────────────────────────────────
document.getElementById("start-btn").addEventListener("click", () => {
  timeLimit = parseInt(document.getElementById("time-limit-select").value);
  document.getElementById("start-screen").style.display = "none";
  document.getElementById("game-screen").style.display  = "block";
  if (timeLimit === 0) document.getElementById("timer-fill").style.display = "none";
  nextPuzzle();
});

// ── PUZZLE FLOW ───────────────────────────────────────────────
function nextPuzzle() {
  clearInterval(timerInterval);
  const puzzle = getRandomSolvablePuzzle();
  puzzleStart  = Date.now();
  elapsed      = 0;
  initCards(puzzle);
  hideFeedback();
  clearInputError();
  if (timeLimit > 0) startCountdown();
  else               startStopwatch();
}

function startCountdown() {
  timeLeft = timeLimit; updateTimerDisplay();
  timerInterval = setInterval(() => {
    timeLeft--; updateTimerDisplay();
    if (timeLeft <= 0) { clearInterval(timerInterval); onTimeout(); }
  }, 1000);
}
function onTimeout() {
  streak = 0; showFeedback("⏱ Time's up!", "timeout"); updateStats();
  setTimeout(nextPuzzle, 1800);
}
function updateTimerDisplay() {
  const pct = timeLimit > 0 ? (timeLeft / timeLimit) * 100 : 100;
  document.getElementById("timer-seconds").textContent = timeLeft;
  document.getElementById("timer-fill").style.width    = pct + "%";
  const color = pct > 50 ? "var(--accent)" : pct > 25 ? "#d4a017" : "var(--danger)";
  document.getElementById("timer-seconds").style.color        = color;
  document.getElementById("timer-fill").style.backgroundColor = color;
}
function startStopwatch() {
  document.getElementById("timer-seconds").textContent = "0";
  timerInterval = setInterval(() => {
    elapsed++;
    document.getElementById("timer-seconds").textContent = elapsed;
  }, 1000);
}

// ── CARD LOGIC ────────────────────────────────────────────────
function initCards(numbers) {
  cards       = numbers.map((n, i) => ({ id: i, value: n, expr: String(n), used: false, isResult: false }));
  selectedIdx = null;
  selectedOp  = null;
  cardHistory = [];
  renderCards();
}

function renderCards() {
  const grid = document.getElementById("card-grid");
  if (!grid) return;
  grid.innerHTML = "";
  const hint = document.getElementById("card-hint");

  cards.forEach((card, i) => {
    const div = document.createElement("div");
    div.className = "num-card";

    if (card.used) {
      div.classList.add("num-card-empty");
    } else if (i === selectedIdx && selectedOp === null) {
      div.classList.add("num-card-ops");
      div.innerHTML = `<div class="op-grid">
        <button class="op-btn" data-op="+">+</button>
        <button class="op-btn" data-op="−">−</button>
        <button class="op-btn" data-op="×">×</button>
        <button class="op-btn" data-op="÷">÷</button>
      </div>`;
      div.querySelectorAll(".op-btn").forEach(btn =>
        btn.addEventListener("click", (e) => { e.stopPropagation(); selectOp(btn.dataset.op); })
      );
      div.addEventListener("click", () => { selectedIdx = null; selectedOp = null; renderCards(); });
    } else if (i === selectedIdx && selectedOp !== null) {
      div.classList.add("num-card-pending");
      div.innerHTML = `<span>${formatVal(card.value)}</span><span class="pending-op">${selectedOp}</span>`;
    } else if (selectedOp !== null) {
      // All non-selected cards pulse to invite a second pick.
      // Result cards get both classes so the accent-coloured pulse fires.
      div.classList.add("num-card-pick2");
      if (card.isResult) div.classList.add("num-card-result");
      div.textContent = formatVal(card.value);
      div.addEventListener("click", () => combineCards(i));
    } else {
      div.classList.add(card.isResult ? "num-card-result" : "num-card-idle");
      div.textContent = formatVal(card.value);
      div.addEventListener("click", () => selectCard(i));
    }
    grid.appendChild(div);
  });

  if (hint) {
    if (selectedIdx === null)    hint.textContent = "Pick a number";
    else if (selectedOp === null) hint.textContent = "Choose an operation";
    else                          hint.textContent = "Pick a second number";
  }
}

function selectCard(idx) {
  if (cards[idx].used) return;
  selectedIdx = idx; selectedOp = null; clearInputError(); renderCards();
}
function selectOp(op) { selectedOp = op; renderCards(); }

function combineCards(bIdx) {
  if (selectedIdx === null || selectedOp === null || bIdx === selectedIdx) return;
  const a = cards[selectedIdx], b = cards[bIdx];
  const raw = OP_MAP[selectedOp];
  let result;
  if (raw === "+")      result = a.value + b.value;
  else if (raw === "-") result = a.value - b.value;
  else if (raw === "*") result = a.value * b.value;
  else {
    if (Math.abs(b.value) < 1e-12) { showInputError("Can't divide by zero"); return; }
    result = a.value / b.value;
  }
  if (!isFinite(result)) { showInputError("Invalid operation"); return; }

  cardHistory.push(JSON.parse(JSON.stringify(cards)));
  cards[selectedIdx] = { ...a, value: result, expr: `(${a.expr} ${selectedOp} ${b.expr})`, isResult: true };
  cards[bIdx]        = { ...b, used: true };
  selectedIdx = null; selectedOp = null; clearInputError();

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
    showInputError(`Result is ${parseFloat(card.value.toFixed(4))}, not 24 — ↩ undo and try again`);
  }
}

// ── UNDO ──────────────────────────────────────────────────────
document.getElementById("undo-btn").addEventListener("click", () => {
  if (!cardHistory.length) return;
  cards = cardHistory.pop();
  selectedIdx = null; selectedOp = null; clearInputError(); renderCards();
});

// ── SKIP ──────────────────────────────────────────────────────
document.getElementById("skip-btn").addEventListener("click", () => {
  clearInterval(timerInterval);
  streak = 0;
  showFeedback("Skipped.", "wrong");
  updateStats();
  setTimeout(nextPuzzle, 1000);
});

// ── UTILS ─────────────────────────────────────────────────────
function formatVal(v) {
  if (Number.isInteger(v)) return String(v);
  return String(parseFloat(v.toFixed(3)));
}
function updateStats() {
  document.getElementById("stat-solved").textContent = solved;
  document.getElementById("stat-streak").textContent = streak;
  if (bestMs  !== null) document.getElementById("stat-best").textContent = (bestMs/1000).toFixed(1) + "s";
  if (solved > 0)       document.getElementById("stat-avg").textContent  = ((totalMs/solved)/1000).toFixed(1) + "s";
}
function showFeedback(msg, type) { const el = document.getElementById("feedback"); el.textContent = msg; el.className = `feedback ${type}`; }
function hideFeedback()          { const el = document.getElementById("feedback"); el.className = "feedback hidden"; el.textContent = ""; }
function showInputError(msg)     { const el = document.getElementById("input-error"); el.textContent = msg; el.style.display = "block"; }
function clearInputError()       { const el = document.getElementById("input-error"); el.textContent = ""; el.style.display = "none"; }