import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  ref, onValue, runTransaction, update, get, set, increment, remove, onDisconnect
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { getRandomSolvablePuzzle } from "./solver.js";

// ── FIREBASE STATE ─────────────────────────────────────────────
const roomCode = new URLSearchParams(window.location.search).get("room");
if (!roomCode) window.location.href = "dashboard.html";

let currentUser        = null;
let isHost             = false;
let room               = null;
let skipInFlight       = false;
let autoAdvanceTimeout = null;
let abandonHandled     = false;

// ── CARD STATE (local, reset each round) ──────────────────────
// cards: [{ value, expr, used, isResult }]
// - value:    number (current value, may be a computed fraction)
// - expr:     display string e.g. "(4 × 6)"
// - used:     true once consumed in a combination
// - isResult: true if this card is a computed result (vs original number)
let cards        = [];
let selectedIdx  = null;   // index of first card chosen
let selectedOp   = null;   // operator chosen after first card
let cardHistory  = [];     // stack of previous card arrays for undo

// ── BOOT ──────────────────────────────────────────────────────
onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "index.html"; return; }
  currentUser = user;
  document.getElementById("user-photo").src            = user.photoURL || "";
  document.getElementById("room-code-nav").textContent = roomCode;

  remove(ref(db, `matchmaking/matched/${user.uid}`));
  remove(ref(db, `matchmaking/seeking/${user.uid}`));

  const onlineRef = ref(db, `rooms/${roomCode}/players/${user.uid}/online`);
  set(onlineRef, true);
  onDisconnect(onlineRef).set(false);

  listenToRoom();
});

// ── ROOM LISTENER ─────────────────────────────────────────────
function listenToRoom() {
  onValue(ref(db, `rooms/${roomCode}`), (snap) => {
    if (!snap.exists()) { alert("Room not found."); window.location.href = "dashboard.html"; return; }
    room = snap.val();
    renderGame();
  });
}

// ── MAIN RENDER ───────────────────────────────────────────────
function renderGame() {
  isHost = room.meta.hostUid === currentUser.uid;
  const is1v1 = room.meta.gameMode === "1v1";

  document.getElementById("round-display").textContent =
    `Round ${room.meta.currentRound + 1} / ${room.settings.totalRounds}`;
  document.getElementById("resign-btn").textContent = is1v1 ? "Resign" : "Leave Room";

  if (is1v1 && room.meta.status === "active" && !abandonHandled) {
    const onlineUids = Object.entries(room.players || {}).filter(([,p]) => p.online).map(([uid]) => uid);
    if (onlineUids.length === 1 && onlineUids[0] === currentUser.uid) {
      const abandonerUid = Object.keys(room.players || {}).find(uid => uid !== currentUser.uid);
      if (abandonerUid) { abandonHandled = true; handleAbandonment(abandonerUid); return; }
    }
  }

  renderSidebars();

  if (room.meta.status === "finished" || room.meta.status === "abandoned") {
    showView("end-view"); renderEndScreen(); return;
  }

  const round = currentRound();
  if (!round) return;

  if (round.status === "active") {
    showView("round-view");
    renderActiveRound(round);
  } else {
    showView("result-view");
    renderResult(round);
  }
}

// ── ACTIVE ROUND ──────────────────────────────────────────────
function renderActiveRound(round) {
  skipInFlight = false;

  // Re-init cards only when puzzle numbers change (i.e. new round)
  const nums     = Object.values(round.numbers);
  const numKey   = nums.join(",");
  if (window._lastNumKey !== numKey) {
    window._lastNumKey = numKey;
    initCards(nums);
  }

  const onlineCount = Object.values(room.players || {}).filter(p => p.online).length;
  const needed = room.settings.skipMode === "unanimous" ? onlineCount : Math.ceil(onlineCount / 2);
  const votes  = Object.keys(round.skipVotes || {}).length;
  document.getElementById("skip-count").textContent  = votes;
  document.getElementById("skip-needed").textContent = needed;
  document.getElementById("skip-btn").style.opacity  = round.skipVotes?.[currentUser.uid] ? "0.4" : "1";

  if (round.status === "active" && needed > 0 && votes >= needed) triggerSkip();
}

// ── RESULT / END VIEWS (unchanged) ────────────────────────────
function renderResult(round) {
  const el = document.getElementById("result-content");
  if (round.status === "solved") {
    el.innerHTML = `<p class="result-winner">🏆 ${round.winnerName}</p><code class="result-solution">${round.solution}</code>`;
  } else {
    el.innerHTML = `<p class="result-skipped">Round skipped.</p>`;
  }
  const is1v1 = room.meta.gameMode === "1v1";
  document.getElementById("next-round-btn").style.display   = (isHost && !is1v1) ? "inline-block" : "none";
  document.getElementById("waiting-for-host").style.display = (!isHost && !is1v1) ? "block" : "none";

  if (is1v1 && isHost && !autoAdvanceTimeout) {
    clearTimeout(autoAdvanceTimeout);
    const msg = document.getElementById("auto-advance-msg");
    msg.style.display = "block"; msg.textContent = "Next round in 3s…";
    autoAdvanceTimeout = setTimeout(async () => {
      autoAdvanceTimeout = null; msg.style.display = "none";
      try { await nextRound(); } catch(e) { console.error("Auto-advance failed:", e); }
    }, 3000);
  }
}

function renderEndScreen() {
  const isAbandoned = room.meta.status === "abandoned";
  document.getElementById("end-title").textContent = isAbandoned ? "Game Ended" : "Game Over";
  const abandonMsg = document.getElementById("abandon-msg");
  if (isAbandoned) {
    abandonMsg.textContent  = room.meta.abandonedBy === currentUser.uid ? "You resigned." : `${room.meta.abandonedName || "Opponent"} left the game.`;
    abandonMsg.style.display = "block";
  } else { abandonMsg.style.display = "none"; }
  const sorted = Object.entries(room.players || {}).sort(([,a],[,b]) => b.roomScore - a.roomScore);
  document.getElementById("final-scores").innerHTML = sorted.map(([uid, p], i) => `
    <div class="final-player ${uid === currentUser.uid ? "is-you" : ""}">
      <span class="final-rank">#${i+1}</span>
      <img src="${p.photoURL||""}" onerror="this.style.display='none'" style="width:30px;height:30px;border-radius:50%;">
      <span class="final-name">${p.displayName}</span>
      <span class="final-score">${p.roomScore} wins</span>
    </div>`).join("");
}

function renderSidebars() {
  const players = Object.entries(room.players || {}).filter(([,p]) => p.online);
  const is1v1   = room.meta.gameMode === "1v1";
  document.getElementById("room-leaderboard").innerHTML = [...players]
    .sort(([,a],[,b]) => b.roomScore - a.roomScore)
    .map(([uid, p]) => `
      <li class="player-item ${uid === currentUser.uid ? "is-you" : ""}">
        <img src="${p.photoURL||""}" style="width:24px;height:24px;border-radius:50%;" onerror="this.style.display='none'">
        <span style="font-size:0.86rem;flex:1;">${p.displayName}</span>
        <span class="player-score">${p.roomScore}</span>
      </li>`).join("");

  const eloSection = document.getElementById("elo-section");
  if (eloSection) eloSection.style.display = is1v1 ? "block" : "none";
  if (is1v1) {
    document.getElementById("elo-list").innerHTML = [...players]
      .sort(([,a],[,b]) => (b.rating??1200)-(a.rating??1200))
      .map(([uid, p]) => `
        <li class="player-item ${uid === currentUser.uid ? "is-you" : ""}">
          <span style="font-size:0.86rem;flex:1;">${p.displayName}</span>
          <span class="player-score">${p.rating??1200}</span>
        </li>`).join("");
  }
}

// ═══════════════════════════════════════════════════════════════
//  CARD COMBINATION LOGIC
// ═══════════════════════════════════════════════════════════════

function initCards(numbers) {
  cards       = numbers.map((n, i) => ({ id: i, value: n, expr: String(n), used: false, isResult: false }));
  selectedIdx = null;
  selectedOp  = null;
  cardHistory = [];
  clearInputError();
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
      // Empty slot
      div.classList.add("num-card-empty");

    } else if (i === selectedIdx && selectedOp === null) {
      // This card was tapped — show operator quadrants
      div.classList.add("num-card-ops");
      div.innerHTML = `
        <div class="op-grid">
          <button class="op-btn" data-op="+">+</button>
          <button class="op-btn" data-op="−">−</button>
          <button class="op-btn" data-op="×">×</button>
          <button class="op-btn" data-op="÷">÷</button>
        </div>`;
      div.querySelectorAll(".op-btn").forEach(btn => {
        btn.addEventListener("click", (e) => { e.stopPropagation(); selectOp(btn.dataset.op); });
      });
      // Tapping again deselects
      div.addEventListener("click", () => { selectedIdx = null; selectedOp = null; renderCards(); });

    } else if (i === selectedIdx && selectedOp !== null) {
      // Pending — first operand confirmed, showing the chosen op
      div.classList.add("num-card-pending");
      div.innerHTML = `
        <span>${formatVal(card.value)}</span>
        <span class="pending-op">${selectedOp}</span>`;

    } else if (selectedOp !== null) {
      div.classList.add("num-card-pick2");
      if (card.isResult) div.classList.add("num-card-result");
      div.textContent = formatVal(card.value);
      div.addEventListener("click", () => combineCards(i));

    } else {
      // Normal idle card
      div.classList.add(card.isResult ? "num-card-result" : "num-card-idle");
      div.textContent = formatVal(card.value);
      div.addEventListener("click", () => selectCard(i));
    }

    grid.appendChild(div);
  });

  // Update hint text
  if (hint) {
    if (selectedIdx === null)          hint.textContent = "Pick a number";
    else if (selectedOp === null)       hint.textContent = "Choose an operation";
    else                                hint.textContent = "Pick a second number";
  }
}

function selectCard(idx) {
  if (cards[idx].used) return;
  selectedIdx = idx;
  selectedOp  = null;
  clearInputError();
  renderCards();
}

// Map display symbols back to real operators for calculation
const OP_MAP = { "+": "+", "−": "-", "×": "*", "÷": "/" };

function selectOp(op) {
  selectedOp = op;
  renderCards();
}

function combineCards(bIdx) {
  if (selectedIdx === null || selectedOp === null) return;
  if (bIdx === selectedIdx) return;

  const a   = cards[selectedIdx];
  const b   = cards[bIdx];
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

  // Save state for undo
  cardHistory.push(JSON.parse(JSON.stringify(cards)));

  const newExpr = `(${a.expr} ${selectedOp} ${b.expr})`;
  cards[selectedIdx] = { ...a, value: result, expr: newExpr, isResult: true };
  cards[bIdx]        = { ...b, used: true };

  selectedIdx = null;
  selectedOp  = null;
  clearInputError();

  const remaining = cards.filter(c => !c.used);
  if (remaining.length === 1) {
    checkWin(remaining[0]);
  } else {
    renderCards();
  }
}

function checkWin(card) {
  if (Math.abs(card.value - 24) < 1e-9) {
    // Build a clean expression for display (already built in card.expr)
    autoSubmit(card.expr);
  } else {
    renderCards();
    showInputError(`Result is ${parseFloat(card.value.toFixed(4))}, not 24 — ↩ undo and try again`);
  }
}

// ── UNDO ──────────────────────────────────────────────────────
document.getElementById("undo-btn").addEventListener("click", () => {
  if (cardHistory.length === 0) return;
  cards       = cardHistory.pop();
  selectedIdx = null;
  selectedOp  = null;
  clearInputError();
  renderCards();
});

// ── AUTO-SUBMIT ───────────────────────────────────────────────
async function autoSubmit(solution) {
  const result = await runTransaction(
    ref(db, `rooms/${roomCode}/rounds/${room.meta.currentRound}`),
    (cur) => {
      if (!cur || cur.status !== "active") return;
      return { ...cur, status: "solved", winnerId: currentUser.uid,
               winnerName: currentUser.displayName, solution, solvedAt: Date.now() };
    }
  );
  if (result.committed) await resolveWin(currentUser.uid);
}

// ── SKIP ──────────────────────────────────────────────────────
document.getElementById("skip-btn").addEventListener("click", async () => {
  const round = currentRound();
  if (!round || round.status !== "active" || round.skipVotes?.[currentUser.uid]) return;
  await update(ref(db, `rooms/${roomCode}/rounds/${room.meta.currentRound}/skipVotes`),
    { [currentUser.uid]: true });
});

async function triggerSkip() {
  if (skipInFlight) return;
  skipInFlight = true;
  try {
    const result = await runTransaction(
      ref(db, `rooms/${roomCode}/rounds/${room.meta.currentRound}`),
      (cur) => { if (!cur || cur.status !== "active") return; return { ...cur, status: "skipped" }; }
    );
    if (result.committed && room.meta.gameMode === "1v1") {
      const updates = {};
      Object.keys(room.players || {}).forEach(uid => { updates[`players/${uid}/roundsPlayed`] = increment(1); });
      if (Object.keys(updates).length) await update(ref(db), updates);
    }
  } finally { skipInFlight = false; }
}

// ── NEXT ROUND ────────────────────────────────────────────────
document.getElementById("next-round-btn").addEventListener("click", () => nextRound());

async function nextRound() {
  if (!isHost) return;
  const next  = room.meta.currentRound + 1;
  const total = room.settings.totalRounds;
  if (next >= total) { await update(ref(db, `rooms/${roomCode}/meta`), { status: "finished" }); return; }
  const numbers = getRandomSolvablePuzzle();
  await update(ref(db), {
    [`rooms/${roomCode}/meta/currentRound`]: next,
    [`rooms/${roomCode}/rounds/${next}`]: {
      numbers, status: "active", startedAt: Date.now(),
      winnerId: null, winnerName: null, solution: null, skipVotes: {}
    }
  });
}

// ── RESIGN ────────────────────────────────────────────────────
document.getElementById("resign-btn").addEventListener("click", async () => {
  const is1v1 = room?.meta?.gameMode === "1v1";
  if (!confirm(is1v1 ? "Resign? This counts as a loss." : "Leave this room?")) return;
  const onlineRef = ref(db, `rooms/${roomCode}/players/${currentUser.uid}/online`);
  onDisconnect(onlineRef).cancel();
  await set(onlineRef, false);
  window.location.href = "dashboard.html";
});

// ── ABANDONMENT ───────────────────────────────────────────────
async function handleAbandonment(abandonerUid) {
  const result = await runTransaction(ref(db, `rooms/${roomCode}/meta/status`),
    (s) => { if (s !== "active") return; return "abandoned"; });
  if (!result.committed) return;
  await update(ref(db, `rooms/${roomCode}/meta`), {
    abandonedBy: abandonerUid,
    abandonedName: room.players?.[abandonerUid]?.displayName || "Opponent"
  });
  await resolveWin(currentUser.uid);
}

// ── WIN RESOLUTION + ELO ──────────────────────────────────────
async function resolveWin(winnerId) {
  const players = room.players || {};
  const allUids = Object.keys(players);
  const is1v1   = room.meta.gameMode === "1v1";
  const updates = {};

  if (is1v1) {
    const reads   = await Promise.all(allUids.map(uid => get(ref(db, `players/${uid}/rating`))));
    const ratings = {};
    allUids.forEach((uid, i) => { ratings[uid] = reads[i].val() ?? 1200; });
    const changes = eloChanges(ratings, winnerId, allUids);
    allUids.forEach(uid => {
      const newRating = Math.max(100, ratings[uid] + changes[uid]);
      updates[`players/${uid}/rating`]                   = newRating;
      updates[`rooms/${roomCode}/players/${uid}/rating`] = newRating;
      updates[`players/${uid}/roundsPlayed`]             = increment(1);
    });
    updates[`players/${winnerId}/wins`] = increment(1);
  }

  updates[`rooms/${roomCode}/players/${winnerId}/roomScore`] = increment(1);
  if (Object.keys(updates).length) await update(ref(db), updates);
}

function expected(rA, rB) { return 1 / (1 + Math.pow(10, (rB - rA) / 400)); }
function eloChanges(ratings, winnerId, uids, K = 32) {
  const d = {};
  uids.forEach(uid => { d[uid] = 0; });
  const Rw = ratings[winnerId] ?? 1200;
  uids.forEach(uid => {
    if (uid === winnerId) return;
    const Ro = ratings[uid] ?? 1200;
    d[winnerId] += K * (1 - expected(Rw, Ro));
    d[uid]      += K * (0 - expected(Ro, Rw));
  });
  return Object.fromEntries(Object.entries(d).map(([uid, v]) => [uid, Math.round(v)]));
}

// ── UTILITIES ─────────────────────────────────────────────────
function currentRound() { return room?.rounds?.[room.meta.currentRound] ?? null; }

// Format a card value: show fractions neatly, avoid floating-point noise
function formatVal(v) {
  if (Number.isInteger(v)) return String(v);
  const r = parseFloat(v.toFixed(3));
  return String(r);
}

function showView(id) {
  ["round-view", "result-view", "end-view"].forEach(v =>
    document.getElementById(v).style.display = v === id ? "block" : "none"
  );
}
function showInputError(msg) { const el = document.getElementById("input-error"); el.textContent = msg; el.style.display = "block"; }
function clearInputError()   { const el = document.getElementById("input-error"); el.textContent = ""; el.style.display = "none"; }