import { auth } from "./firebase-config.js";
import {
  GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

onAuthStateChanged(auth, (user) => {
  if (!user) return;
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