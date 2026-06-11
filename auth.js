import { auth, db } from "./firebase-config.js";
import {
  GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, get } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const ALLOWED_DOMAIN = "stjohnscollege.co.za";

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  const domain = user.email?.split("@")[1];
  if (domain !== ALLOWED_DOMAIN) {
    await signOut(auth);
    showError(`Only @${ALLOWED_DOMAIN} accounts can sign in.`);
    return;
  }

  // Check if this user has chosen a username yet
  const snap = await get(ref(db, `players/${user.uid}/username`));
  if (!snap.exists()) {
    // First time — go pick a username
    window.location.href = "username.html";
    return;
  }

  // Returning user — go to saved redirect or dashboard
  const redirect = sessionStorage.getItem("redirectAfterLogin");
  if (redirect) {
    sessionStorage.removeItem("redirectAfterLogin");
    window.location.href = redirect;
    return;
  }
  window.location.href = "dashboard.html";
});

document.getElementById("sign-in-btn").addEventListener("click", async () => {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ hd: ALLOWED_DOMAIN });
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    if (err.code !== "auth/popup-closed-by-user") {
      showError("Sign-in failed. Try again.");
      console.error(err);
    }
  }
});

function showError(msg) {
  let el = document.getElementById("auth-error");
  if (!el) {
    el = Object.assign(document.createElement("p"), { id: "auth-error" });
    el.style.cssText = "color:var(--danger);font-size:0.85rem;margin-top:16px;";
    document.querySelector(".landing-card").appendChild(el);
  }
  el.textContent = msg;
}