import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  ref, onValue, runTransaction, update, get, set, increment, remove, onDisconnect
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { validateExpression } from "./validator.js";
import { getRandomSolvablePuzzle } from "./solver.js";

const roomCode = new URLSearchParams(window.location.search).get("room");
if (!roomCode) window.location.href = "dashboard.html";

let currentUser        = null;
let isHost             = false;
let room               = null;
let expr               = "";
let skipInFlight       = false;
let autoAdvanceTimeout = null;
let abandonHandled     = false;

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
    const onlineUids = Object.entries(room.players || {})
      .filter(([, p]) => p.online).map(([uid]) => uid);
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

  if (round.status === "active") { showView("round-view"); renderActiveRound(round); }
  else                           { showView("result-view"); renderResult(round); }
}

// ── ACTIVE ROUND ──────────────────────────────────────────────
function renderActiveRound(round) {
  skipInFlight = false;
  clearTimeout(autoAdvanceTimeout);
  autoAdvanceTimeout = null;
  document.getElementById("auto-advance-msg").style.display = "none";

  const nums = Object.values(round.numbers);
  const numKey = nums.join(",");
  if (window._lastNumKey !== numKey) {
    window._lastNumKey = numKey; expr = ""; updateExprDisplay(); clearInputError();
  }

  document.getElementById("keypad-numbers").innerHTML = nums
    .map(n => `<button class="key key-num" data-val="${n}">${n}</button>`).join("");
  document.querySelectorAll(".key-num").forEach(btn =>
    btn.addEventListener("click", () => appendToExpr(btn.dataset.val))
  );

  const onlineCount = Object.values(room.players || {}).filter(p => p.online).length;
  const needed = room.settings.skipMode === "unanimous" ? onlineCount : Math.ceil(onlineCount / 2);
  const votes  = Object.keys(round.skipVotes || {}).length;
  document.getElementById("skip-count").textContent  = votes;
  document.getElementById("skip-needed").textContent = needed;
  document.getElementById("skip-btn").style.opacity  = round.skipVotes?.[currentUser.uid] ? "0.4" : "1";

  if (round.status === "active" && needed > 0 && votes >= needed) triggerSkip();
}

// ── RESULT VIEW ───────────────────────────────────────────────
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

  if (is1v1 && isHost) {
    clearTimeout(autoAdvanceTimeout);
    const msg = document.getElementById("auto-advance-msg");
    msg.style.display  = "block";
    msg.textContent    = "Next round in 3s…";
    autoAdvanceTimeout = setTimeout(async () => {
      autoAdvanceTimeout = null;
      msg.style.display  = "none";
      try { await nextRound(); } catch (err) { console.error("Auto-advance failed:", err); }
    }, 3000);
  }
}

// ── END SCREEN ────────────────────────────────────────────────
function renderEndScreen() {
  const isAbandoned = room.meta.status === "abandoned";
  document.getElementById("end-title").textContent = isAbandoned ? "Game Ended" : "Game Over";
  const msg = document.getElementById("abandon-msg");
  if (isAbandoned) {
    const wasMe = room.meta.abandonedBy === currentUser.uid;
    msg.textContent = wasMe ? "You resigned." : `${room.meta.abandonedName || "Opponent"} left the game.`;
    msg.style.display = "block";
  } else { msg.style.display = "none"; }

  const sorted = Object.entries(room.players || {}).sort(([,a],[,b]) => b.roomScore - a.roomScore);
  document.getElementById("final-scores").innerHTML = sorted.map(([uid, p], i) => `
    <div class="final-player ${uid === currentUser.uid ? "is-you" : ""}">
      <span class="final-rank">#${i+1}</span>
      <img src="${p.photoURL||""}" onerror="this.style.display='none'" style="width:30px;height:30px;border-radius:50%;">
      <span class="final-name">${p.displayName}</span>
      <span class="final-score">${p.roomScore} wins</span>
    </div>`).join("");
}

// ── SIDEBARS ──────────────────────────────────────────────────
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

// ── KEYPAD ────────────────────────────────────────────────────
function appendToExpr(val) { expr += val; updateExprDisplay(); clearInputError(); }

// Fix: regex identifies entire final token (e.g. "12", "+", "(") and deletes it
function backspace() { 
  expr = expr.replace(/(\d+|[+\-*/()])$/, ''); 
  updateExprDisplay(); 
}

function clearExpr() { expr = ""; updateExprDisplay(); clearInputError(); }

function updatePopupState() {
  const popup = document.getElementById("op-popup");
  if (!popup) return;
  // If last character is a digit or closing bracket, show ops
  const expectsOperator = /[\d)]$/.test(expr.trim());
  popup.classList.toggle("visible", expectsOperator);
}

function updateExprDisplay() {
  document.getElementById("expr-text").textContent = expr.replace(/\*/g,"×").replace(/\//g,"÷");
  document.getElementById("expr-display").classList.toggle("has-content", expr.length > 0);
  updatePopupState();
}

// Event Listeners for statically rendered keys
document.querySelectorAll(".key-op").forEach(btn    => btn.addEventListener("click", () => appendToExpr(btn.dataset.val)));
document.querySelectorAll(".key-paren").forEach(btn => btn.addEventListener("click", () => appendToExpr(btn.dataset.val)));
document.getElementById("key-back").addEventListener("click",  backspace);
document.getElementById("key-clear").addEventListener("click", clearExpr);

window.addEventListener("keydown", (e) => {
  const round = currentRound();
  if (!round || round.status !== "active") return;
  if (e.key === "Backspace")              { e.preventDefault(); backspace(); }
  else if (e.key === "Enter")             { handleSubmit(); }
  else if (e.key === "Escape")            { clearExpr(); }
  else if (/^[\d+\-*/().]$/.test(e.key)) { appendToExpr(e.key); }
});

// ── SUBMIT ────────────────────────────────────────────────────
document.getElementById("submit-btn").addEventListener("click", handleSubmit);

async function handleSubmit() {
  const round = currentRound();
  if (!round || round.status !== "active") return;
  const check = validateExpression(expr, Object.values(round.numbers));
  if (!check.valid) { showInputError(check.message); return; }
  clearInputError();

  const result = await runTransaction(
    ref(db, `rooms/${roomCode}/rounds/${room.meta.currentRound}`),
    (cur) => {
      if (!cur || cur.status !== "active") return;
      return { ...cur, status:"solved", winnerId:currentUser.uid,
               winnerName:currentUser.displayName, solution:expr, solvedAt:Date.now() };
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
      (cur) => { if (!cur || cur.status !== "active") return; return { ...cur, status:"skipped" }; }
    );
    if (result.committed) {
      if (room.meta.gameMode === "1v1") {
        const updates = {};
        Object.keys(room.players || {}).forEach(uid => {
          updates[`players/${uid}/roundsPlayed`] = increment(1);
        });
        if (Object.keys(updates).length) await update(ref(db), updates);
      }
    }
  } finally { skipInFlight = false; }
}

// ── NEXT ROUND ────────────────────────────────────────────────
document.getElementById("next-round-btn").addEventListener("click", () => nextRound());

async function nextRound() {
  if (!isHost) return;
  const next  = room.meta.currentRound + 1;
  const total = room.settings.totalRounds;
  if (next >= total) { await update(ref(db, `rooms/${roomCode}/meta`), { status:"finished" }); return; }
  const numbers = getRandomSolvablePuzzle();
  await update(ref(db), {
    [`rooms/${roomCode}/meta/currentRound`]: next,
    [`rooms/${roomCode}/rounds/${next}`]: {
      numbers, status:"active", startedAt:Date.now(),
      winnerId:null, winnerName:null, solution:null, skipVotes:{}
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

// ── WIN RESOLUTION ────────────────────────────────────────────
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
      updates[`players/${uid}/rating`]                    = newRating;
      updates[`rooms/${roomCode}/players/${uid}/rating`]  = newRating;
      updates[`players/${uid}/roundsPlayed`]              = increment(1);
    });
    updates[`players/${winnerId}/wins`] = increment(1);
  }

  updates[`rooms/${roomCode}/players/${winnerId}/roomScore`] = increment(1);
  if (Object.keys(updates).length) await update(ref(db), updates);
}

// ── ELO ───────────────────────────────────────────────────────
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
function showView(id)   { ["round-view","result-view","end-view"].forEach(v => document.getElementById(v).style.display = v===id?"block":"none"); }
function showInputError(msg) { const el=document.getElementById("input-error"); el.textContent=msg; el.style.display="block"; }
function clearInputError()   { const el=document.getElementById("input-error"); el.textContent=""; el.style.display="none"; }