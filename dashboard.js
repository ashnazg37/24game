import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, set, get, update, remove, onValue, onDisconnect } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { getRandomSolvablePuzzle } from "./solver.js";
import { copyText } from "./utils.js";

let currentUser = null, pendingCode = null;
let seekUnsub = null, roomUnsub = null, mySeekRef = null;

function generateCode() {
  const c = "ABCDEFGHJKMNPQRSTUVWXYZ2346789";
  let s = "";
  for (let i = 0; i < 6; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}
async function getMyRating() { const s = await get(ref(db, `players/${currentUser.uid}/rating`)); return s.val() ?? 1200; }
async function upsertPlayer() {
  const r = ref(db, `players/${currentUser.uid}`), s = await get(r);
  if (!s.exists()) {
    await set(r, { displayName: currentUser.displayName, photoURL: currentUser.photoURL || "", rating: 1200, wins: 0, roundsPlayed: 0 });
    return 1200;
  }
  await update(r, { displayName: currentUser.displayName, photoURL: currentUser.photoURL || "" });
  return s.val().rating ?? 1200;
}
function playerRecord(rating) { return { displayName: currentUser.displayName, photoURL: currentUser.photoURL || "", roomScore: 0, online: true, rating }; }

// Boot
onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "index.html"; return; }
  currentUser = user;
  document.getElementById("user-name").textContent = user.displayName;
  document.getElementById("user-photo").src = user.photoURL || "";
  pendingCode = generateCode();
  document.getElementById("preview-code").textContent = pendingCode;
  onValue(ref(db, "matchmaking/seeking"), (snap) => {
    const n = snap.exists() ? Object.keys(snap.val()).length : 0;
    const el = document.getElementById("waiting-count");
    if (el) el.textContent = n === 0 ? "No one waiting yet" : n === 1 ? "1 player waiting" : `${n} players waiting`;
  });
});

// Copy buttons
document.getElementById("copy-invite-btn").addEventListener("click", () =>
  copyText(window.location.origin, document.getElementById("copy-invite-btn"), "Copy invite link"));
document.getElementById("copy-room-link-btn").addEventListener("click", () =>
  copyText(`${window.location.origin}/lobby.html?room=${pendingCode}`, document.getElementById("copy-room-link-btn"), "Copy room link"));

// Create room
document.getElementById("create-btn").addEventListener("click", async () => {
  const totalRounds = parseInt(document.getElementById("total-rounds").value) || 10;
  const skipMode = document.getElementById("skip-mode").value;
  const rated = document.getElementById("rated-room").checked;
  let code = pendingCode;
  if ((await get(ref(db, `rooms/${code}/meta`))).exists()) {
    code = generateCode(); pendingCode = code;
    document.getElementById("preview-code").textContent = code;
  }
  const rating = await upsertPlayer();
  await set(ref(db, `rooms/${code}`), {
    meta: { hostUid: currentUser.uid, status: "lobby", currentRound: 0, createdAt: Date.now(), rated },
    settings: { totalRounds, skipMode },
    players: { [currentUser.uid]: playerRecord(rating) }
  });
  window.location.href = `lobby.html?room=${code}`;
});

// Join room
document.getElementById("join-btn").addEventListener("click", async () => {
  const code = document.getElementById("join-input").value.trim().toUpperCase();
  if (code.length !== 6) { showError("Room codes are 6 characters."); return; }
  const snap = await get(ref(db, `rooms/${code}`));
  if (!snap.exists()) { showError("Room not found."); return; }
  if (snap.val().meta.status !== "lobby") { showError("That game has already started."); return; }
  const rating = await upsertPlayer();
  await set(ref(db, `rooms/${code}/players/${currentUser.uid}`), playerRecord(rating));
  window.location.href = `lobby.html?room=${code}`;
});

// Sign out
document.getElementById("sign-out-btn").addEventListener("click", async () => {
  await signOut(auth); window.location.href = "index.html";
});

// 1v1 matchmaking
document.getElementById("find-btn").addEventListener("click", startSeek);
document.getElementById("cancel-btn").addEventListener("click", cancelSeek);

let dotsTimer = null;
function showSearching(on) {
  document.getElementById("idle-state").classList.toggle("hidden", on);
  document.getElementById("searching-state").classList.toggle("visible", on);
  if (on) { let n = 3; dotsTimer = setInterval(() => { n = (n % 3) + 1; document.getElementById("dots").textContent = ".".repeat(n); }, 500); }
  else clearInterval(dotsTimer);
}

async function startSeek() {
  await upsertPlayer();
  const myRating = await getMyRating();
  const rated = document.getElementById("rated-1v1").checked;
  mySeekRef = ref(db, `matchmaking/seeking/${currentUser.uid}`);
  await set(mySeekRef, { uid: currentUser.uid, displayName: currentUser.displayName, photoURL: currentUser.photoURL || "", rating: myRating, joinedAt: Date.now(), rated });
  onDisconnect(mySeekRef).remove();
  showSearching(true);
  roomUnsub = onValue(ref(db, `matchmaking/matched/${currentUser.uid}`), (snap) => {
    if (!snap.exists()) return;
    cleanup(); window.location.href = `game.html?room=${snap.val()}`;
  });
  seekUnsub = onValue(ref(db, "matchmaking/seeking"), async (snap) => {
    if (!snap.exists()) return;
    const pool = snap.val();
    if (!pool[currentUser.uid]) return;
    const myRated = pool[currentUser.uid].rated ?? true;
    const others = Object.entries(pool)
      .filter(([uid, d]) => uid !== currentUser.uid && (d.rated ?? true) === myRated)
      .sort(([, a], [, b]) => a.joinedAt - b.joinedAt);
    if (!others.length) return;
    const [oppUid, oppData] = others[0];
    if (currentUser.uid > oppUid) return;
    if (seekUnsub) { seekUnsub(); seekUnsub = null; }
    await createMatch(oppUid, oppData, myRated);
  });
}

async function createMatch(oppUid, oppData, rated) {
  const code = generateCode(), numbers = getRandomSolvablePuzzle(), myRating = await getMyRating();
  await set(ref(db, `rooms/${code}`), {
    meta: { hostUid: currentUser.uid, status: "active", currentRound: 0, createdAt: Date.now(), gameMode: "1v1", rated },
    settings: { totalRounds: 3, skipMode: "unanimous" },
    players: {
      [currentUser.uid]: { displayName: currentUser.displayName, photoURL: currentUser.photoURL || "", roomScore: 0, online: true, rating: myRating },
      [oppUid]: { displayName: oppData.displayName, photoURL: oppData.photoURL || "", roomScore: 0, online: true, rating: oppData.rating ?? 1200 }
    },
    rounds: { 0: { numbers, status: "active", startedAt: Date.now(), winnerId: null, winnerName: null, solution: null, skipVotes: {} } }
  });
  await update(ref(db), {
    [`matchmaking/matched/${currentUser.uid}`]: code, [`matchmaking/matched/${oppUid}`]: code,
    [`matchmaking/seeking/${currentUser.uid}`]: null, [`matchmaking/seeking/${oppUid}`]: null
  });
  cleanup(); window.location.href = `game.html?room=${code}`;
}

async function cancelSeek() {
  cleanup();
  if (mySeekRef) { onDisconnect(mySeekRef).cancel(); await remove(mySeekRef); mySeekRef = null; }
  await remove(ref(db, `matchmaking/matched/${currentUser.uid}`));
}
function cleanup() { showSearching(false); if (seekUnsub) { seekUnsub(); seekUnsub = null; } if (roomUnsub) { roomUnsub(); roomUnsub = null; } }
function showError(msg) { const el = document.getElementById("error-msg"); el.textContent = msg; el.style.display = "block"; }