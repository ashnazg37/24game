import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, onValue, runTransaction, update, get, set, increment, remove, onDisconnect } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { getRandomSolvablePuzzle } from "./solver.js";

const roomCode = new URLSearchParams(window.location.search).get("room");
if (!roomCode) window.location.href = "dashboard.html";

let currentUser = null, isHost = false, room = null;
let skipInFlight = false, autoAdvanceTimeout = null, abandonHandled = false;
let cards = [], selectedIdx = null, selectedOp = null, cardHistory = [];
const OPS = { "+": (a,b)=>a+b, "−": (a,b)=>a-b, "×": (a,b)=>a*b, "÷": (a,b)=>a/b };

function setStatus(msg) { const h = document.getElementById("card-hint"); if (h) h.textContent = msg; }

onAuthStateChanged(auth, (user) => {
  if (!user) { sessionStorage.setItem("redirectAfterLogin", window.location.href); window.location.href = "index.html"; return; }
  currentUser = user;
  document.getElementById("user-photo").src = user.photoURL || "";
  document.getElementById("room-code-nav").textContent = roomCode;
  remove(ref(db, `matchmaking/matched/${user.uid}`)).catch(()=>{});
  remove(ref(db, `matchmaking/seeking/${user.uid}`)).catch(()=>{});
  const onlineRef = ref(db, `rooms/${roomCode}/players/${user.uid}/online`);
  set(onlineRef, true).catch(()=>{});
  onDisconnect(onlineRef).set(false);
  onValue(ref(db, `rooms/${roomCode}`), (snap) => {
    try {
      if (!snap.exists()) { alert("Room not found."); window.location.href = "dashboard.html"; return; }
      room = snap.val(); renderGame();
    } catch (err) { console.error("renderGame:", err); setStatus("Error: " + err.message); }
  });
});

function renderGame() {
  if (!currentUser || !room?.meta) { setStatus("Loading..."); return; }
  isHost = room.meta.hostUid === currentUser.uid;
  const is1v1 = room.meta.gameMode === "1v1";
  const rated = room.meta.rated !== false;
  const total = room.settings?.totalRounds ?? 0;
  document.getElementById("round-display").textContent = `Round ${room.meta.currentRound + 1} / ${total}`;
  document.getElementById("resign-btn").textContent = is1v1 ? "Resign" : "Leave Room";
  document.getElementById("rated-badge").textContent = rated ? "⚡ Rated" : "Unrated";

  if (is1v1 && room.meta.status === "active" && !abandonHandled) {
    const onlineUids = Object.entries(room.players || {}).filter(([,p]) => p.online).map(([uid]) => uid);
    if (onlineUids.length === 1 && onlineUids[0] === currentUser.uid) {
      const gone = Object.keys(room.players || {}).find(uid => uid !== currentUser.uid);
      if (gone) { abandonHandled = true; handleAbandonment(gone); return; }
    }
  }

  renderSidebars();
  if (room.meta.status === "finished" || room.meta.status === "abandoned") { showView("end-view"); renderEndScreen(); return; }
  if (room.meta.status === "lobby") { setStatus("Waiting for game to start..."); return; }
  const round = currentRound();
  if (!round) { setStatus("Waiting for round data..."); if (isHost) initMissingRound(); return; }
  if (round.status === "active") { showView("round-view"); renderActiveRound(round); }
  else { showView("result-view"); renderResult(round); }
}

function renderActiveRound(round) {
  skipInFlight = false;
  clearTimeout(autoAdvanceTimeout); autoAdvanceTimeout = null;
  document.getElementById("auto-advance-msg").style.display = "none";
  let nums = Array.isArray(round.numbers) ? round.numbers : (round.numbers ? Object.values(round.numbers) : []);
  if (!nums.length) { setStatus("Waiting for puzzle..."); if (isHost) initMissingRound(); return; }
  const numKey = nums.join(",") + "@" + room.meta.currentRound;
  if (window._lastNumKey !== numKey) {
    window._lastNumKey = numKey;
    cards = nums.map(n => ({ value: Number(n), expr: String(n), used: false, isResult: false }));
    selectedIdx = null; selectedOp = null; cardHistory = [];
    clearInputError();
  }
  renderCards();
  const onlineCount = Object.values(room.players || {}).filter(p => p.online).length || 1;
  const needed = room.settings?.skipMode === "unanimous" ? onlineCount : Math.ceil(onlineCount / 2);
  const votes = Object.keys(round.skipVotes || {}).length;
  document.getElementById("skip-count").textContent = votes;
  document.getElementById("skip-needed").textContent = needed;
  document.getElementById("skip-btn").style.opacity = round.skipVotes?.[currentUser.uid] ? "0.4" : "1";
  if (round.status === "active" && needed > 0 && votes >= needed) triggerSkip();
}

async function initMissingRound() {
  if (!isHost) return;
  const idx = room.meta.currentRound;
  const snap = await get(ref(db, `rooms/${roomCode}/rounds/${idx}`));
  if (snap.exists() && snap.val()?.numbers) return;
  const numbers = getRandomSolvablePuzzle();
  await update(ref(db), { [`rooms/${roomCode}/rounds/${idx}`]: { numbers, status: "active", startedAt: Date.now(), winnerId: null, winnerName: null, solution: null, skipVotes: {} } });
}

// Card rendering — hardcoded hex, no CSS vars
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
  grid.style.cssText = "display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:10px;width:100%;margin-bottom:10px;aspect-ratio:1/1;max-height:340px;";
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
      div.onclick = () => { selectedIdx = i; selectedOp = null; clearInputError(); renderCards(); };
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

function combine(bIdx) {
  if (selectedIdx === null || selectedOp === null || bIdx === selectedIdx) return;
  const a = cards[selectedIdx], b = cards[bIdx];
  if (selectedOp === "÷" && Math.abs(b.value) < 1e-12) { showInputError("Can't divide by zero"); return; }
  const result = OPS[selectedOp](a.value, b.value);
  if (!isFinite(result)) { showInputError("Invalid"); return; }
  cardHistory.push(JSON.parse(JSON.stringify(cards)));
  cards[selectedIdx] = { value: result, expr: `(${a.expr} ${selectedOp} ${b.expr})`, used: false, isResult: true };
  cards[bIdx] = { ...b, used: true };
  selectedIdx = null; selectedOp = null; clearInputError();
  const rem = cards.filter(c => !c.used);
  if (rem.length === 1) { if (Math.abs(rem[0].value - 24) < 1e-9) autoSubmit(rem[0].expr); else { renderCards(); showInputError(`= ${fmt(rem[0].value)}, not 24 — ↩ undo`); } }
  else renderCards();
}

document.getElementById("undo-btn").addEventListener("click", () => { if (!cardHistory.length) return; cards = cardHistory.pop(); selectedIdx = null; selectedOp = null; clearInputError(); renderCards(); });

async function autoSubmit(solution) {
  const result = await runTransaction(ref(db, `rooms/${roomCode}/rounds/${room.meta.currentRound}`),
    (cur) => { if (!cur || cur.status !== "active") return; return { ...cur, status: "solved", winnerId: currentUser.uid, winnerName: currentUser.displayName, solution, solvedAt: Date.now() }; });
  if (result.committed) await resolveWin(currentUser.uid);
}

document.getElementById("skip-btn").addEventListener("click", async () => {
  const round = currentRound();
  if (!round || round.status !== "active" || round.skipVotes?.[currentUser.uid]) return;
  await update(ref(db, `rooms/${roomCode}/rounds/${room.meta.currentRound}/skipVotes`), { [currentUser.uid]: true });
});

async function triggerSkip() {
  if (skipInFlight) return; skipInFlight = true;
  try {
    const result = await runTransaction(ref(db, `rooms/${roomCode}/rounds/${room.meta.currentRound}`),
      (cur) => { if (!cur || cur.status !== "active") return; return { ...cur, status: "skipped" }; });
  } finally { skipInFlight = false; }
}

function renderResult(round) {
  const el = document.getElementById("result-content");
  if (round.status === "solved") el.innerHTML = `<p class="result-winner">🏆 ${round.winnerName}</p><code class="result-solution">${round.solution}</code>`;
  else el.innerHTML = `<p class="result-skipped">Round skipped.</p>`;
  const is1v1 = room.meta.gameMode === "1v1";
  document.getElementById("next-round-btn").style.display = (isHost && !is1v1) ? "inline-block" : "none";
  document.getElementById("waiting-for-host").style.display = (!isHost && !is1v1) ? "block" : "none";
  if (is1v1 && isHost) {
    clearTimeout(autoAdvanceTimeout);
    const msg = document.getElementById("auto-advance-msg");
    msg.style.display = "block"; msg.textContent = "Next round in 3s…";
    autoAdvanceTimeout = setTimeout(async () => { autoAdvanceTimeout = null; msg.style.display = "none"; try { await nextRound(); } catch(e) { console.error(e); } }, 3000);
  }
}

function renderEndScreen() {
  const isAb = room.meta.status === "abandoned";
  document.getElementById("end-title").textContent = isAb ? "Game Ended" : "Game Over";
  const msg = document.getElementById("abandon-msg");
  if (isAb) { msg.textContent = room.meta.abandonedBy === currentUser.uid ? "You resigned." : `${room.meta.abandonedName || "Opponent"} left.`; msg.style.display = "block"; }
  else msg.style.display = "none";
  document.getElementById("final-scores").innerHTML = Object.entries(room.players || {}).sort(([,a],[,b]) => b.roomScore - a.roomScore)
    .map(([uid, p], i) => `<div class="final-player ${uid === currentUser.uid ? "is-you" : ""}"><span class="final-rank">#${i+1}</span><img src="${p.photoURL||""}" onerror="this.style.display='none'" style="width:30px;height:30px;border-radius:50%;"><span class="final-name">${p.displayName}</span><span class="final-score">${p.roomScore} wins</span></div>`).join("");
}

function renderSidebars() {
  const players = Object.entries(room.players || {}).filter(([,p]) => p.online);
  const is1v1 = room.meta.gameMode === "1v1";
  const rated = room.meta.rated !== false;
  document.getElementById("room-leaderboard").innerHTML = [...players].sort(([,a],[,b]) => b.roomScore - a.roomScore)
    .map(([uid, p]) => `<li class="player-item ${uid === currentUser.uid ? "is-you" : ""}"><img src="${p.photoURL||""}" style="width:24px;height:24px;border-radius:50%;" onerror="this.style.display='none'"><span style="font-size:0.86rem;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.displayName}</span><span class="player-score">${p.roomScore}</span></li>`).join("");
  const eloSection = document.getElementById("elo-section");
  eloSection.style.display = (is1v1 && rated) ? "block" : "none";
  if (is1v1 && rated) {
    document.getElementById("elo-list").innerHTML = [...players].sort(([,a],[,b]) => (b.rating??1200) - (a.rating??1200))
      .map(([uid, p]) => `<li class="player-item ${uid === currentUser.uid ? "is-you" : ""}"><span style="font-size:0.86rem;flex:1;">${p.displayName}</span><span class="player-score">${p.rating??1200}</span></li>`).join("");
  }
}

document.getElementById("next-round-btn").addEventListener("click", () => nextRound());
async function nextRound() {
  if (!isHost) return;
  const next = room.meta.currentRound + 1;
  if (next >= room.settings.totalRounds) { await update(ref(db, `rooms/${roomCode}/meta`), { status: "finished" }); return; }
  const numbers = getRandomSolvablePuzzle();
  await update(ref(db), { [`rooms/${roomCode}/meta/currentRound`]: next, [`rooms/${roomCode}/rounds/${next}`]: { numbers, status: "active", startedAt: Date.now(), winnerId: null, winnerName: null, solution: null, skipVotes: {} } });
}

document.getElementById("resign-btn").addEventListener("click", async () => {
  if (!confirm(room?.meta?.gameMode === "1v1" ? "Resign? This counts as a loss." : "Leave this room?")) return;
  const onlineRef = ref(db, `rooms/${roomCode}/players/${currentUser.uid}/online`);
  onDisconnect(onlineRef).cancel(); await set(onlineRef, false);
  window.location.href = "dashboard.html";
});

async function handleAbandonment(abandonerUid) {
  const result = await runTransaction(ref(db, `rooms/${roomCode}/meta/status`), (s) => { if (s !== "active") return; return "abandoned"; });
  if (!result.committed) return;
  await update(ref(db, `rooms/${roomCode}/meta`), { abandonedBy: abandonerUid, abandonedName: room.players?.[abandonerUid]?.displayName || "Opponent" });
  await resolveWin(currentUser.uid);
}

async function resolveWin(winnerId) {
  const players = room.players || {}, allUids = Object.keys(players);
  const rated = room.meta.rated !== false;
  const is1v1 = room.meta.gameMode === "1v1";
  const updates = {};
  if (rated) {
    const reads = await Promise.all(allUids.map(uid => get(ref(db, `players/${uid}/rating`))));
    const ratings = {}; allUids.forEach((uid, i) => { ratings[uid] = reads[i].val() ?? 1200; });
    const K = 32, Rw = ratings[winnerId] ?? 1200;
    allUids.forEach(uid => {
      let delta = 0;
      if (uid === winnerId) { allUids.forEach(o => { if (o !== uid) delta += K * (1 - 1/(1+Math.pow(10,(ratings[o]-Rw)/400))); }); }
      else { const Ro = ratings[uid] ?? 1200; delta = K * (0 - 1/(1+Math.pow(10,(Rw-Ro)/400))); }
      const nr = Math.max(100, Math.round(ratings[uid] + delta));
      updates[`players/${uid}/rating`] = nr;
      updates[`rooms/${roomCode}/players/${uid}/rating`] = nr;
      updates[`players/${uid}/roundsPlayed`] = increment(1);
    });
    updates[`players/${winnerId}/wins`] = increment(1);
  }
  updates[`rooms/${roomCode}/players/${winnerId}/roomScore`] = increment(1);
  if (Object.keys(updates).length) await update(ref(db), updates);
}

function currentRound() {
  if (!room?.rounds) return null;
  const idx = room.meta.currentRound;
  if (Array.isArray(room.rounds)) return room.rounds[idx] ?? null;
  return room.rounds[idx] ?? room.rounds[String(idx)] ?? null;
}
function fmt(v) { return Number.isInteger(v) ? String(v) : String(parseFloat(v.toFixed(3))); }
function showView(id) { ["round-view","result-view","end-view"].forEach(v => document.getElementById(v).style.display = v === id ? "block" : "none"); }
function showInputError(msg) { const el = document.getElementById("input-error"); el.textContent = msg; el.style.display = "block"; }
function clearInputError() { const el = document.getElementById("input-error"); el.textContent = ""; el.style.display = "none"; }