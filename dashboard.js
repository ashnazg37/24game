import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, set, get, update, remove, onValue, onDisconnect, push }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { getRandomSolvablePuzzle } from "./solver.js";
import { copyText } from "./utils.js";

let currentUser     = null;
let currentUsername = null;
let pendingCode     = null;
let seekUnsub = null, roomUnsub = null, mySeekRef = null;

// ── HELPERS ───────────────────────────────────────────────────
function encodeEmail(e) { return e.toLowerCase().replace(/\./g,"-dot-").replace(/@/g,"-at-"); }
function generateCode() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ2346789";
  let c = "";
  for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}
async function getMyRating() { const s = await get(ref(db,`players/${currentUser.uid}/rating`)); return s.val()??1200; }
async function upsertPlayer() {
  const r = ref(db,`players/${currentUser.uid}`);
  const s = await get(r);
  if (!s.exists()) {
    await set(r,{displayName:currentUser.displayName,photoURL:currentUser.photoURL||"",username:currentUsername||"",rating:1200,wins:0,roundsPlayed:0});
    return 1200;
  }
  await update(r,{displayName:currentUser.displayName,photoURL:currentUser.photoURL||""});
  return s.val().rating??1200;
}
function playerRecord(rating) {
  return {displayName:currentUser.displayName,photoURL:currentUser.photoURL||"",roomScore:0,online:true,rating,username:currentUsername||""};
}

// ── BOOT ──────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "index.html"; return; }
  currentUser = user;

  // Fetch username
  const uSnap = await get(ref(db,`players/${user.uid}/username`));
  if (!uSnap.exists()) { window.location.href = "username.html"; return; }
  currentUsername = uSnap.val();

  document.getElementById("user-name").textContent  = `${user.displayName} (${currentUsername})`;
  document.getElementById("user-photo").src          = user.photoURL || "";

  pendingCode = generateCode();
  document.getElementById("preview-code").textContent = pendingCode;

  // Live 1v1 queue count
  onValue(ref(db,"matchmaking/seeking"), (snap) => {
    const n = snap.exists() ? Object.keys(snap.val()).length : 0;
    const el = document.getElementById("waiting-count");
    if (!el) return;
    el.textContent = n === 0 ? "No one waiting yet" : n === 1 ? "1 player waiting" : `${n} players waiting`;
  });

  // Listen for incoming invitations
  onValue(ref(db,`invitations/${user.uid}`), (snap) => {
    const section = document.getElementById("invitations-section");
    const list    = document.getElementById("invitations-list");
    if (!snap.exists()) { section.style.display = "none"; return; }
    const pending = Object.entries(snap.val()).filter(([,inv]) => inv.status === "pending");
    if (!pending.length) { section.style.display = "none"; return; }
    section.style.display = "block";
    list.innerHTML = pending.map(([fromUid, inv]) => `
      <div class="invite-card">
        <div class="invite-info">
          <div class="invite-from">${inv.fromDisplayName} (${inv.fromUsername||"?"})</div>
          <div class="invite-type">${inv.type === "1v1" ? "⚔ 1v1 Challenge" : "🏠 Room invite"} · Room ${inv.roomCode}</div>
        </div>
        <div class="invite-btns">
          <button class="btn btn-primary" onclick="acceptInv('${fromUid}','${inv.roomCode}')">Accept</button>
          <button class="btn btn-secondary" onclick="declineInv('${fromUid}')">Decline</button>
        </div>
      </div>`).join("");
  });
});

// ── COPY BUTTONS ──────────────────────────────────────────────
document.getElementById("copy-invite-btn").addEventListener("click", () =>
  copyText(window.location.origin, document.getElementById("copy-invite-btn"), "Copy invite link"));
document.getElementById("copy-room-link-btn").addEventListener("click", () =>
  copyText(`${window.location.origin}/lobby.html?room=${pendingCode}`,
    document.getElementById("copy-room-link-btn"), "Copy room link"));

// ── CREATE ROOM ───────────────────────────────────────────────
document.getElementById("create-btn").addEventListener("click", async () => {
  const totalRounds = parseInt(document.getElementById("total-rounds").value) || 10;
  const skipMode    = document.getElementById("skip-mode").value;
  let code = pendingCode;
  if ((await get(ref(db,`rooms/${code}/meta`))).exists()) {
    code = generateCode(); pendingCode = code;
    document.getElementById("preview-code").textContent = code;
  }
  const rating = await upsertPlayer();
  await set(ref(db,`rooms/${code}`), {
    meta:     {hostUid:currentUser.uid,hostName:currentUser.displayName,status:"lobby",currentRound:0,createdAt:Date.now()},
    settings: {totalRounds,skipMode},
    players:  {[currentUser.uid]:playerRecord(rating)}
  });
  window.location.href = `lobby.html?room=${code}`;
});

// ── JOIN ROOM ─────────────────────────────────────────────────
document.getElementById("join-btn").addEventListener("click", async () => {
  const code = document.getElementById("join-input").value.trim().toUpperCase();
  if (code.length !== 6) { showError("Room codes are 6 characters."); return; }
  const snap = await get(ref(db,`rooms/${code}`));
  if (!snap.exists())                     { showError("Room not found."); return; }
  if (snap.val().meta.status !== "lobby") { showError("That game has already started."); return; }
  const rating = await upsertPlayer();
  await set(ref(db,`rooms/${code}/players/${currentUser.uid}`), playerRecord(rating));
  window.location.href = `lobby.html?room=${code}`;
});

// ── SIGN OUT ──────────────────────────────────────────────────
document.getElementById("sign-out-btn").addEventListener("click", async () => {
  await signOut(auth); window.location.href = "index.html";
});

// ── 1v1 MATCHMAKING ───────────────────────────────────────────
document.getElementById("find-btn").addEventListener("click",    startSeek);
document.getElementById("cancel-btn").addEventListener("click",  cancelSeek);

let dotsTimer = null;
function showSearching(on) {
  document.getElementById("idle-state").classList.toggle("hidden", on);
  document.getElementById("searching-state").classList.toggle("visible", on);
  if (on) { let n=3; dotsTimer=setInterval(()=>{n=(n%3)+1;document.getElementById("dots").textContent=".".repeat(n);},500); }
  else    { clearInterval(dotsTimer); }
}

async function startSeek() {
  await upsertPlayer();
  const myRating = await getMyRating();
  mySeekRef = ref(db,`matchmaking/seeking/${currentUser.uid}`);
  await set(mySeekRef,{uid:currentUser.uid,displayName:currentUser.displayName,photoURL:currentUser.photoURL||"",rating:myRating,joinedAt:Date.now()});
  onDisconnect(mySeekRef).remove();
  showSearching(true);
  const myMatchRef = ref(db,`matchmaking/matched/${currentUser.uid}`);
  roomUnsub = onValue(myMatchRef,(snap)=>{ if(!snap.exists())return; cleanup(); window.location.href=`game.html?room=${snap.val()}`; });
  seekUnsub = onValue(ref(db,"matchmaking/seeking"),async(snap)=>{
    if(!snap.exists())return;
    const pool=snap.val();
    if(!pool[currentUser.uid])return;
    const others=Object.entries(pool).filter(([uid])=>uid!==currentUser.uid).sort(([,a],[,b])=>a.joinedAt-b.joinedAt);
    if(!others.length)return;
    const [oppUid,oppData]=others[0];
    if(currentUser.uid>oppUid)return;
    if(seekUnsub){seekUnsub();seekUnsub=null;}
    await createMatchmadeRoom(oppUid,oppData);
  });
}

async function createMatchmadeRoom(oppUid,oppData) {
  const code=generateCode(), numbers=getRandomSolvablePuzzle(), myRating=await getMyRating();
  await set(ref(db,`rooms/${code}`),{
    meta:{hostUid:currentUser.uid,status:"active",currentRound:0,createdAt:Date.now(),gameMode:"1v1"},
    settings:{totalRounds:3,skipMode:"unanimous"},
    players:{
      [currentUser.uid]:{displayName:currentUser.displayName,photoURL:currentUser.photoURL||"",roomScore:0,online:true,rating:myRating,username:currentUsername||""},
      [oppUid]:          {displayName:oppData.displayName,    photoURL:oppData.photoURL||"",    roomScore:0,online:true,rating:oppData.rating??1200,username:oppData.username||""}
    },
    rounds:{0:{numbers,status:"active",startedAt:Date.now(),winnerId:null,winnerName:null,solution:null,skipVotes:{}}}
  });
  await update(ref(db),{
    [`matchmaking/matched/${currentUser.uid}`]:code,
    [`matchmaking/matched/${oppUid}`]:code,
    [`matchmaking/seeking/${currentUser.uid}`]:null,
    [`matchmaking/seeking/${oppUid}`]:null
  });
  cleanup();
  window.location.href=`game.html?room=${code}`;
}

async function cancelSeek() {
  cleanup();
  if (mySeekRef) { onDisconnect(mySeekRef).cancel(); await remove(mySeekRef); mySeekRef=null; }
  await remove(ref(db,`matchmaking/matched/${currentUser.uid}`));
}

function cleanup() {
  showSearching(false);
  if (seekUnsub){seekUnsub();seekUnsub=null;}
  if (roomUnsub){roomUnsub();roomUnsub=null;}
}

// ── INVITE A PLAYER ───────────────────────────────────────────
async function findPlayerUid(input) {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.includes("@")) {
    // Email lookup
    const snap = await get(ref(db,`emails/${encodeEmail(trimmed)}`));
    return snap.val() || null;
  } else {
    // Username lookup (case-insensitive)
    const snap = await get(ref(db,`usernames/${trimmed.toLowerCase()}`));
    return snap.val() || null;
  }
}

document.getElementById("invite-1v1-btn").addEventListener("click", async () => {
  const input = document.getElementById("invite-input").value.trim();
  if (!input) { showInviteError("Enter a username or email."); return; }
  clearInviteMessages();

  const targetUid = await findPlayerUid(input);
  if (!targetUid)         { showInviteError("Player not found."); return; }
  if (targetUid === currentUser.uid) { showInviteError("You can't challenge yourself."); return; }

  // Create a lobby-style 1v1 room and send invitation
  const code   = generateCode();
  const rating = await getMyRating();
  await set(ref(db,`rooms/${code}`), {
    meta:     {hostUid:currentUser.uid,status:"lobby",currentRound:0,createdAt:Date.now(),gameMode:"1v1"},
    settings: {totalRounds:3,skipMode:"unanimous"},
    players:  {[currentUser.uid]:{displayName:currentUser.displayName,photoURL:currentUser.photoURL||"",roomScore:0,online:true,rating,username:currentUsername||""}}
  });
  await set(ref(db,`invitations/${targetUid}/${currentUser.uid}`), {
    fromUid:         currentUser.uid,
    fromUsername:    currentUsername || "",
    fromDisplayName: currentUser.displayName,
    type:  "1v1",
    roomCode: code,
    status: "pending",
    createdAt: Date.now()
  });
  window.location.href = `lobby.html?room=${code}`;
});

document.getElementById("invite-room-btn").addEventListener("click", async () => {
  const input = document.getElementById("invite-input").value.trim();
  if (!input) { showInviteError("Enter a username or email."); return; }
  clearInviteMessages();

  const targetUid = await findPlayerUid(input);
  if (!targetUid)         { showInviteError("Player not found."); return; }
  if (targetUid === currentUser.uid) { showInviteError("Can't invite yourself."); return; }

  // Check that the pendingCode room exists
  const snap = await get(ref(db,`rooms/${pendingCode}/meta`));
  if (!snap.exists()) {
    showInviteError("Create a room first, then invite players to it.");
    return;
  }
  await set(ref(db,`invitations/${targetUid}/${currentUser.uid}`), {
    fromUid:         currentUser.uid,
    fromUsername:    currentUsername || "",
    fromDisplayName: currentUser.displayName,
    type:  "room",
    roomCode: pendingCode,
    status: "pending",
    createdAt: Date.now()
  });
  showInviteSuccess(`Invitation sent to ${input}!`);
});

// ── ACCEPT / DECLINE ─────────────────────────────────────────
window.acceptInv = async function(fromUid, roomCode) {
  await update(ref(db,`invitations/${currentUser.uid}/${fromUid}`),{status:"accepted"});
  const rating = await upsertPlayer();
  await set(ref(db,`rooms/${roomCode}/players/${currentUser.uid}`),playerRecord(rating));
  window.location.href = `lobby.html?room=${roomCode}`;
};
window.declineInv = async function(fromUid) {
  await update(ref(db,`invitations/${currentUser.uid}/${fromUid}`),{status:"declined"});
};

// ── UI HELPERS ────────────────────────────────────────────────
function showError(msg)        { const el=document.getElementById("error-msg"); el.textContent=msg; el.style.display="block"; }
function showInviteError(msg)  { const el=document.getElementById("invite-error"); el.textContent=msg; el.style.display="block"; }
function showInviteSuccess(msg){ const el=document.getElementById("invite-success"); el.textContent=msg; el.style.display="block"; }
function clearInviteMessages() {
  document.getElementById("invite-error").style.display="none";
  document.getElementById("invite-success").style.display="none";
}