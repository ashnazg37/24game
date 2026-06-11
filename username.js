import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, get, set, update } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const VALID = /^[a-zA-Z0-9_]{3,20}$/;
let currentUser = null;
let checkTimer  = null;
let lastChecked = "";

function encodeEmail(e) {
  return e.toLowerCase().replace(/\./g, "-dot-").replace(/@/g, "-at-");
}

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "index.html"; return; }
  currentUser = user;

  // If they already have a username, skip this page
  const snap = await get(ref(db, `players/${user.uid}/username`));
  if (snap.exists()) {
    const redirect = sessionStorage.getItem("redirectAfterLogin");
    sessionStorage.removeItem("redirectAfterLogin");
    window.location.href = redirect || "dashboard.html";
  }
});

const input  = document.getElementById("username-input");
const status = document.getElementById("username-status");
const btn    = document.getElementById("save-btn");

input.addEventListener("input", () => {
  const val = input.value.trim();
  btn.disabled = true;
  clearTimeout(checkTimer);

  if (!val) { status.textContent = ""; status.style.color = ""; return; }
  if (!VALID.test(val)) {
    status.textContent = "Only letters, numbers and underscores (3–20 chars)";
    status.style.color = "var(--danger)";
    return;
  }
  status.textContent = "Checking…"; status.style.color = "var(--muted)";

  checkTimer = setTimeout(async () => {
    const key = val.toLowerCase();
    if (key === lastChecked) return;
    lastChecked = key;
    const snap = await get(ref(db, `usernames/${key}`));
    if (snap.exists()) {
      status.textContent = "That username is taken";
      status.style.color = "var(--danger)";
    } else {
      status.textContent = `✓ "${val}" is available`;
      status.style.color = "var(--success,#34d399)";
      btn.disabled = false;
    }
  }, 400);
});

btn.addEventListener("click", async () => {
  const val = input.value.trim();
  if (!currentUser || !VALID.test(val) || btn.disabled) return;
  btn.disabled = true; btn.textContent = "Saving…";

  const key = val.toLowerCase();
  try {
    // Double-check uniqueness
    const snap = await get(ref(db, `usernames/${key}`));
    if (snap.exists() && snap.val() !== currentUser.uid) {
      showErr("That username was just taken. Try another."); btn.disabled = false; btn.textContent = "Save username"; return;
    }

    // Write everything atomically via multi-path update
    const updates = {
      [`usernames/${key}`]:                     currentUser.uid,
      [`emails/${encodeEmail(currentUser.email)}`]: currentUser.uid,
      [`players/${currentUser.uid}/username`]:  val,
      [`players/${currentUser.uid}/email`]:     currentUser.email,
      [`players/${currentUser.uid}/displayName`]: currentUser.displayName,
      [`players/${currentUser.uid}/photoURL`]:  currentUser.photoURL || "",
    };
    // Only set rating/wins/roundsPlayed if the player record is new
    const existing = await get(ref(db, `players/${currentUser.uid}/rating`));
    if (!existing.exists()) {
      updates[`players/${currentUser.uid}/rating`]       = 1200;
      updates[`players/${currentUser.uid}/wins`]         = 0;
      updates[`players/${currentUser.uid}/roundsPlayed`] = 0;
    }
    await update(ref(db), updates);

    const redirect = sessionStorage.getItem("redirectAfterLogin");
    sessionStorage.removeItem("redirectAfterLogin");
    window.location.href = redirect || "dashboard.html";
  } catch (e) {
    showErr("Save failed. Try again."); btn.disabled = false; btn.textContent = "Save username";
    console.error(e);
  }
});

function showErr(msg) {
  const el = document.getElementById("save-error");
  el.textContent = msg; el.style.display = "block";
}