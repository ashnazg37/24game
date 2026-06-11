// If someone follows a room invite link while not signed in,
// save the URL and send them to login first.
import { auth as _authCheck } from "./firebase-config.js";
import { onAuthStateChanged as _oac } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
_oac(_authCheck, user => {
  if (!user) {
    sessionStorage.setItem("redirectAfterLogin", window.location.href);
    window.location.href = "index.html";
  }
}, { once: true });

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, get, set, update, onValue, onDisconnect } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { getRandomSolvablePuzzle } from "./solver.js";

const roomCode = new URLSearchParams(window.location.search).get("room");
if (!roomCode) window.location.href = "dashboard.html";

let currentUser = null;
let isHost      = false;

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "index.html"; return; }
  currentUser = user;

  // Ensure username exists
  const uSnap = await get(ref(db, `players/${user.uid}/username`));
  if (!uSnap.exists()) {
    sessionStorage.setItem("redirectAfterLogin", window.location.href);
    window.location.href = "username.html";
    return;
  }

  document.getElementById("user-name").textContent        = user.displayName;
  document.getElementById("user-photo").src               = user.photoURL || "";
  document.getElementById("room-code-display").textContent = roomCode;
  setupPresence();
  listenToRoom();
});

import { copyText } from "./utils.js";

document.getElementById("copy-room-link-btn").addEventListener("click", () => {
  const link = `${window.location.origin}/lobby.html?room=${roomCode}`;
  copyText(link, document.getElementById("copy-room-link-btn"), "Copy link");
});

function setupPresence() {
  const onlineRef = ref(db, `rooms/${roomCode}/players/${currentUser.uid}/online`);
  set(onlineRef, true);
  onDisconnect(onlineRef).set(false);
}

function listenToRoom() {
  onValue(ref(db, `rooms/${roomCode}`), (snap) => {
    if (!snap.exists()) { alert("Room no longer exists."); window.location.href = "dashboard.html"; return; }
    const room = snap.val();
    if (room.meta.status === "active") { window.location.href = `game.html?room=${roomCode}`; return; }

    isHost = room.meta.hostUid === currentUser.uid;
    document.getElementById("host-controls").style.display = isHost  ? "block" : "none";
    document.getElementById("waiting-msg").style.display   = !isHost ? "block" : "none";
    renderPlayers(room.players || {});
  });
}

function renderPlayers(players) {
  const online = Object.entries(players).filter(([, p]) => p.online);
  document.getElementById("player-list").innerHTML = online.map(([, p]) => `
    <li class="player-item">
      <img src="${p.photoURL || ""}" style="width:32px;height:32px;border-radius:50%;" onerror="this.style.display='none'">
      <span>${p.displayName}</span>
      <span style="margin-left:auto;font-family:var(--font-mono);font-size:0.8rem;color:var(--muted);">${p.rating ?? 1200}</span>
    </li>
  `).join("");
  const n = online.length;
  document.getElementById("player-count").textContent = `${n} player${n !== 1 ? "s" : ""} joined`;
}

document.getElementById("start-btn").addEventListener("click", async () => {
  if (!isHost) return;
  const numbers = getRandomSolvablePuzzle();
  await update(ref(db), {
    [`rooms/${roomCode}/meta/status`]:       "active",
    [`rooms/${roomCode}/meta/currentRound`]: 0,
    [`rooms/${roomCode}/rounds/0`]: {
      numbers, status: "active", startedAt: Date.now(),
      winnerId: null, winnerName: null, solution: null, skipVotes: {}
    }
  });
});