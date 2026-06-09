import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, get } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

let currentUser = null;

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "index.html"; return; }
  currentUser = user;
  load();
});

document.getElementById("refresh-btn").addEventListener("click", load);

async function load() {
  document.getElementById("loading").style.display    = "block";
  document.getElementById("lb-table").style.display   = "none";
  document.getElementById("empty").style.display      = "none";

  const snap = await get(ref(db, "players"));

  document.getElementById("loading").style.display = "none";

  if (!snap.exists()) { document.getElementById("empty").style.display = "block"; return; }

  const players = Object.entries(snap.val())
    .map(([uid, d]) => ({ uid, ...d }))
    .filter(p => (p.roundsPlayed ?? 0) > 0)
    .sort((a, b) => (b.rating ?? 1200) - (a.rating ?? 1200));

  if (!players.length) { document.getElementById("empty").style.display = "block"; return; }

  document.getElementById("lb-body").innerHTML = players.map((p, i) => {
    const winPct = p.roundsPlayed > 0 ? Math.round((p.wins / p.roundsPlayed) * 100) : 0;
    const you    = p.uid === currentUser?.uid;
    return `
      <tr class="${you ? "is-you" : ""}">
        <td class="lb-rank">${i + 1}</td>
        <td><div class="lb-name">
          <img src="${p.photoURL || ""}" onerror="this.style.display='none'">
          ${p.displayName}${you ? " (you)" : ""}
        </div></td>
        <td class="lb-rating">${p.rating ?? 1200}</td>
        <td class="lb-stat">${p.wins ?? 0}</td>
        <td class="lb-stat">${p.roundsPlayed ?? 0}</td>
        <td class="lb-stat">${winPct}%</td>
      </tr>
    `;
  }).join("");

  document.getElementById("lb-table").style.display = "table";
}