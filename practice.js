import { validateExpression } from "./validator.js";
import { getRandomSolvablePuzzle } from "./solver.js";

// ── STATE ─────────────────────────────────────────────────────
let puzzle        = null;
let timeLimit     = 60;
let timeLeft      = 60;
let elapsed       = 0;
let timerInterval = null;
let puzzleStart   = null;
let expr          = "";   // expression built via keypad

// Session stats
let solved = 0, streak = 0, bestMs = null, totalMs = 0;

// ── START ──────────────────────────────────────────────────────
document.getElementById("start-btn").addEventListener("click", () => {
  timeLimit = parseInt(document.getElementById("time-limit-select").value);
  document.getElementById("start-screen").style.display  = "none";
  document.getElementById("game-screen").style.display   = "block";
  if (timeLimit === 0) document.getElementById("timer-fill").style.display = "none";
  nextPuzzle();
});

// ── PUZZLE FLOW ───────────────────────────────────────────────
function nextPuzzle() {
  clearInterval(timerInterval);
  puzzle      = getRandomSolvablePuzzle();
  puzzleStart = Date.now();
  elapsed     = 0;
  expr        = "";

  // Render number keys with this puzzle's values
  document.getElementById("keypad-numbers").innerHTML = puzzle
    .map(n => `<button class="key key-num" data-val="${n}">${n}</button>`)
    .join("");
  document.querySelectorAll(".key-num").forEach(btn =>
    btn.addEventListener("click", () => appendToExpr(btn.dataset.val))
  );

  updateExprDisplay();
  document.getElementById("input-error").style.display = "none";
  hideFeedback();

  if (timeLimit > 0) startCountdown();
  else               startStopwatch();
}

function startCountdown() {
  timeLeft = timeLimit;
  updateTimerDisplay();
  timerInterval = setInterval(() => {
    timeLeft--;
    updateTimerDisplay();
    if (timeLeft <= 0) { clearInterval(timerInterval); onTimeout(); }
  }, 1000);
}

function onTimeout() {
  streak = 0;
  showFeedback("⏱ Time's up!", "timeout");
  updateStats();
  setTimeout(nextPuzzle, 1800);
}

function updateTimerDisplay() {
  const pct = timeLimit > 0 ? (timeLeft / timeLimit) * 100 : 100;
  document.getElementById("timer-seconds").textContent = timeLeft;
  document.getElementById("timer-fill").style.width    = pct + "%";
  const color = pct > 50 ? "var(--accent)" : pct > 25 ? "#ffaa00" : "var(--danger)";
  document.getElementById("timer-seconds").style.color        = color;
  document.getElementById("timer-fill").style.backgroundColor = color;
}

function startStopwatch() {
  document.getElementById("timer-seconds").style.color = "var(--accent)";
  document.getElementById("timer-seconds").textContent = "0";
  timerInterval = setInterval(() => {
    elapsed++;
    document.getElementById("timer-seconds").textContent = elapsed;
  }, 1000);
}

// ── KEYPAD ────────────────────────────────────────────────────
function appendToExpr(val) {
  expr += val;
  updateExprDisplay();
  document.getElementById("input-error").style.display = "none";
}
function backspace() { expr = expr.slice(0, -1); updateExprDisplay(); }
function clearExpr()  { expr = ""; updateExprDisplay(); }

function updateExprDisplay() {
  const display = expr.replace(/\*/g, "×").replace(/\//g, "÷");
  document.getElementById("expr-text").textContent = display;
  document.getElementById("expr-display").classList.toggle("has-content", expr.length > 0);
}

// Operator + utility buttons (attached once)
document.querySelectorAll(".key-op").forEach(btn =>
  btn.addEventListener("click", () => appendToExpr(btn.dataset.val))
);
document.querySelectorAll(".key-paren").forEach(btn =>
  btn.addEventListener("click", () => appendToExpr(btn.dataset.val))
);
document.getElementById("key-back").addEventListener("click",  backspace);
document.getElementById("key-clear").addEventListener("click", clearExpr);

// Keyboard support
window.addEventListener("keydown", (e) => {
  if (!puzzle) return;
  if (e.key === "Backspace")              { e.preventDefault(); backspace(); }
  else if (e.key === "Enter")             { handleSubmit(); }
  else if (e.key === "Escape")            { clearExpr(); }
  else if (/^[\d+\-*/().]$/.test(e.key)) { appendToExpr(e.key); }
});

// ── SUBMIT ────────────────────────────────────────────────────
document.getElementById("submit-btn").addEventListener("click", handleSubmit);

function handleSubmit() {
  if (!puzzle) return;
  const check = validateExpression(expr, puzzle);
  if (!check.valid) {
    const el = document.getElementById("input-error");
    el.textContent = check.message; el.style.display = "block";
    return;
  }
  document.getElementById("input-error").style.display = "none";

  clearInterval(timerInterval);
  const ms = Date.now() - puzzleStart;
  solved++; streak++; totalMs += ms;
  if (bestMs === null || ms < bestMs) bestMs = ms;

  showFeedback(`✓ Solved in ${(ms / 1000).toFixed(1)}s`, "correct");
  updateStats();
  setTimeout(nextPuzzle, 1400);
}

// ── SKIP ──────────────────────────────────────────────────────
document.getElementById("skip-btn").addEventListener("click", () => {
  clearInterval(timerInterval);
  streak = 0;
  showFeedback("Skipped.", "wrong");
  updateStats();
  setTimeout(nextPuzzle, 1000);
});

// ── UI ────────────────────────────────────────────────────────
function updateStats() {
  document.getElementById("stat-solved").textContent = solved;
  document.getElementById("stat-streak").textContent = streak;
  if (bestMs !== null) document.getElementById("stat-best").textContent = (bestMs / 1000).toFixed(1) + "s";
  if (solved > 0)      document.getElementById("stat-avg").textContent  = ((totalMs / solved) / 1000).toFixed(1) + "s";
}
function showFeedback(msg, type) { const el = document.getElementById("feedback"); el.textContent = msg; el.className = `feedback ${type}`; }
function hideFeedback()          { const el = document.getElementById("feedback"); el.className = "feedback hidden"; el.textContent = ""; }