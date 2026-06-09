import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  ref, set, get, update, remove, onValue, onDisconnect
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { getRandomSolvablePuzzle } from "./solver.js";

let currentUser   = null;
let pendingCode   = null;
let seekUnsub     = null;   // unsubscribe for seeking listener
let roomUnsub     = null;   // unsubscribe for matched-room listener
let mySeekRef     = null;

// ── BOOT ─────────────────────────────────────────────────────
onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "index.html"; return; }
  currentUser = user;
  document.getElementById("user-name").textContent = user.displayName;
  document.getElementById("user-photo").src         = user.photoURL || "";
  pendingCode = generateCode();
  document.getElementById("preview-code").textContent = pendingCode;

  // Live count of players currently in the 1v1 queue
  onValue(ref(db, "matchmaking/seeking"), (snap) => {
    const count = snap.exists() ? Object.keys(snap.val()).length : 0;
    const el = document.getElementById("waiting-count");
    if (!el) return;
    if (count === 0)     el.textContent = "No one waiting yet";
    else if (count === 1) el.textContent = "1 player waiting for a match";
    else                  el.textContent = `${count} players waiting for a match`;
  });
});

// Copy invite link (just the root URL — anyone can sign in and play)
document.getElementById("copy-invite-btn").addEventListener("click", () => {
  navigator.clipboard.writeText(window.location.origin).then(() => {
    const btn = document.getElementById("copy-invite-btn");
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = "Copy invite link"; }, 2000);
  });
});

// ── HELPERS ──────────────────────────────────────────────────
function generateCode() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ2346789";
  let c = "";
  for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

async function getMyRating() {
  const s = await get(ref(db, `players/${currentUser.uid}/rating`));
  return s.val() ?? 1200;
}

async function upsertPlayer() {
  const r = ref(db, `players/${currentUser.uid}`);
  const s = await get(r);
  if (!s.exists()) {
    await set(r, { displayName: currentUser.displayName, photoURL: currentUser.photoURL || "", rating: 1200, wins: 0, roundsPlayed: 0 });
    return 1200;
  }
  await update(r, { displayName: currentUser.displayName, photoURL: currentUser.photoURL || "" });
  return s.val().rating ?? 1200;
}

function playerRecord(rating) {
  return { displayName: currentUser.displayName, photoURL: currentUser.photoURL || "", roomScore: 0, online: true, rating };
}

// ── CREATE ROOM ───────────────────────────────────────────────
document.getElementById("create-btn").addEventListener("click", async () => {
  const totalRounds = parseInt(document.getElementById("total-rounds").value) || 10;
  const skipMode    = document.getElementById("skip-mode").value;

  let code = pendingCode;
  if ((await get(ref(db, `rooms/${code}/meta`))).exists()) {
    code = generateCode(); pendingCode = code;
    document.getElementById("preview-code").textContent = code;
  }

  const rating = await upsertPlayer();
  await set(ref(db, `rooms/${code}`), {
    meta:     { hostUid: currentUser.uid, hostName: currentUser.displayName, status: "lobby", currentRound: 0, createdAt: Date.now() },
    settings: { totalRounds, skipMode },
    players:  { [currentUser.uid]: playerRecord(rating) }
  });
  window.location.href = `lobby.html?room=${code}`;
});

// ── JOIN ROOM ─────────────────────────────────────────────────
document.getElementById("join-btn").addEventListener("click", async () => {
  const code = document.getElementById("join-input").value.trim().toUpperCase();
  if (code.length !== 6) { showError("Room codes are 6 characters."); return; }
  const snap = await get(ref(db, `rooms/${code}`));
  if (!snap.exists())                     { showError("Room not found."); return; }
  if (snap.val().meta.status !== "lobby") { showError("That game has already started."); return; }
  const rating = await upsertPlayer();
  await set(ref(db, `rooms/${code}/players/${currentUser.uid}`), playerRecord(rating));
  window.location.href = `lobby.html?room=${code}`;
});

// ── SIGN OUT ──────────────────────────────────────────────────
document.getElementById("sign-out-btn").addEventListener("click", async () => {
  await signOut(auth); window.location.href = "index.html";
});

// ── 1v1 MATCHMAKING ───────────────────────────────────────────
// Each player writes to /matchmaking/seeking/{uid}.
// When two players are in the pool, the one with the lexicographically
// SMALLER uid creates the room — deterministic, no transaction needed.
// onDisconnect().remove() ensures stale entries are cleaned up.

document.getElementById("find-btn").addEventListener("click", startSeek);
document.getElementById("cancel-btn").addEventListener("click", cancelSeek);

let dotsTimer = null;
function showSearching(on) {
  document.getElementById("idle-state").classList.toggle("hidden", on);
  document.getElementById("searching-state").classList.toggle("visible", on);
  if (on) {
    let n = 3;
    dotsTimer = setInterval(() => { n = (n % 3) + 1; document.getElementById("dots").textContent = ".".repeat(n); }, 500);
  } else {
    clearInterval(dotsTimer);
  }
}

async function startSeek() {
  await upsertPlayer();
  const myRating = await getMyRating();

  mySeekRef = ref(db, `matchmaking/seeking/${currentUser.uid}`);

  const myData = {
    uid: currentUser.uid,
    displayName: currentUser.displayName,
    photoURL: currentUser.photoURL || "",
    rating: myRating,
    joinedAt: Date.now()
  };

  // Write myself into the pool; remove on disconnect
  await set(mySeekRef, myData);
  onDisconnect(mySeekRef).remove();

  showSearching(true);

  // Listen for a room being created for me
  const myMatchRef = ref(db, `matchmaking/matched/${currentUser.uid}`);
  roomUnsub = onValue(myMatchRef, (snap) => {
    if (!snap.exists()) return;
    const code = snap.val();
    // Clean up and go
    cleanup();
    window.location.href = `game.html?room=${code}`;
  });

  // Listen to the seeking pool
  seekUnsub = onValue(ref(db, "matchmaking/seeking"), async (snap) => {
    if (!snap.exists()) return;
    const pool = snap.val();

    // Am I still in the pool?
    if (!pool[currentUser.uid]) return;

    // Find the other player (pick the one with earliest joinedAt that isn't me)
    const others = Object.entries(pool)
      .filter(([uid]) => uid !== currentUser.uid)
      .sort(([, a], [, b]) => a.joinedAt - b.joinedAt);

    if (others.length === 0) return;

    const [oppUid, oppData] = others[0];

    // Only the player with the SMALLER uid creates the room.
    // This is deterministic: exactly one of the two players creates.
    if (currentUser.uid > oppUid) return;

    // Stop listening so we don't create multiple rooms
    if (seekUnsub) { seekUnsub(); seekUnsub = null; }

    await createRoom(oppUid, oppData);
  });
}

async function createRoom(oppUid, oppData) {
  const code    = generateCode();
  const numbers = getRandomSolvablePuzzle();
  const myRating = await getMyRating();

  await set(ref(db, `rooms/${code}`), {
    meta: { hostUid: currentUser.uid, status: "active", currentRound: 0, createdAt: Date.now(), gameMode: "1v1" },
    settings: { totalRounds: 10, skipMode: "majority" },
    players: {
      [currentUser.uid]: { displayName: currentUser.displayName, photoURL: currentUser.photoURL || "", roomScore: 0, online: true, rating: myRating },
      [oppUid]:          { displayName: oppData.displayName,     photoURL: oppData.photoURL || "",     roomScore: 0, online: true, rating: oppData.rating ?? 1200 }
    },
    rounds: {
      0: { numbers, status: "active", startedAt: Date.now(), winnerId: null, winnerName: null, solution: null, skipVotes: {} }
    }
  });

  // Write room code to both players' matched nodes, remove both from seeking
  await update(ref(db), {
    [`matchmaking/matched/${currentUser.uid}`]: code,
    [`matchmaking/matched/${oppUid}`]:          code,
    [`matchmaking/seeking/${currentUser.uid}`]: null,
    [`matchmaking/seeking/${oppUid}`]:          null
  });

  cleanup();
  window.location.href = `game.html?room=${code}`;
}

async function cancelSeek() {
  cleanup();
  if (mySeekRef) {
    onDisconnect(mySeekRef).cancel();
    await remove(mySeekRef);
    mySeekRef = null;
  }
  await remove(ref(db, `matchmaking/matched/${currentUser.uid}`));
}

function cleanup() {
  showSearching(false);
  if (seekUnsub) { seekUnsub(); seekUnsub = null; }
  if (roomUnsub) { roomUnsub(); roomUnsub = null; }
}

function showError(msg) {
  const el = document.getElementById("error-msg");
  el.textContent = msg; el.style.display = "block";
}