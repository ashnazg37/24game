import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, get } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

let currentUser = null, allPlayers = [], activeTab = "elo";

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "index.html"; return; }
  currentUser = user;
  load();
});

// Tab switching
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    activeTab = btn.dataset.tab;
    renderTab();
  });
});

document.getElementById("refresh-btn").addEventListener("click", load);

async function load() {
  document.getElementById("loading").style.display = "block";
  document.getElementById("elo-table").style.display = "none";
  document.getElementById("practice-table").style.display = "none";
  document.getElementById("empty").style.display = "none";
  const snap = await get(ref(db, "players"));
  document.getElementById("loading").style.display = "none";
  if (!snap.exists()) { document.getElementById("empty").style.display = "block"; return; }
  allPlayers = Object.entries(snap.val()).map(([uid, d]) => ({ uid, ...d }));
  renderTab();
}

function renderTab() {
  document.getElementById("tab-elo").style.display = activeTab === "elo" ? "block" : "none";
  document.getElementById("tab-practice").style.display = activeTab === "practice" ? "block" : "none";
  if (activeTab === "elo") renderElo();
  else renderPractice();
}

function renderElo() {
  const players = allPlayers.filter(p => (p.roundsPlayed ?? 0) > 0).sort((a, b) => (b.rating ?? 1200) - (a.rating ?? 1200));
  if (!players.length) { document.getElementById("empty").style.display = "block"; document.getElementById("elo-table").style.display = "none"; return; }
  document.getElementById("empty").style.display = "none";
  document.getElementById("elo-body").innerHTML = players.map((p, i) => {
    const pct = p.roundsPlayed > 0 ? Math.round((p.wins / p.roundsPlayed) * 100) : 0;
    const you = p.uid === currentUser?.uid;
    return `<tr class="${you ? "is-you" : ""}">
      <td class="lb-rank">${i + 1}</td>
      <td><div class="lb-name"><img src="${p.photoURL || ""}" onerror="this.style.display='none'"><span>${p.displayName}${you ? " (you)" : ""}</span></div></td>
      <td class="lb-rating">${p.rating ?? 1200}</td>
      <td class="lb-stat">${p.wins ?? 0}</td>
      <td class="lb-stat">${p.roundsPlayed ?? 0}</td>
      <td class="lb-stat">${pct}%</td>
    </tr>`;
  }).join("");
  document.getElementById("elo-table").style.display = "table";
}

function renderPractice() {
  const players = allPlayers
    .filter(p => p.practiceBestTime != null || p.practiceBestStreak != null)
    .sort((a, b) => {
      // Sort by best time ascending (fastest first), null last
      const at = a.practiceBestTime ?? Infinity;
      const bt = b.practiceBestTime ?? Infinity;
      if (at !== bt) return at - bt;
      return (b.practiceBestStreak ?? 0) - (a.practiceBestStreak ?? 0);
    });
  if (!players.length) { document.getElementById("empty").style.display = "block"; document.getElementById("practice-table").style.display = "none"; return; }
  document.getElementById("empty").style.display = "none";
  document.getElementById("practice-body").innerHTML = players.map((p, i) => {
    const you = p.uid === currentUser?.uid;
    const time = p.practiceBestTime != null ? (p.practiceBestTime / 1000).toFixed(1) + "s" : "—";
    const streak = p.practiceBestStreak ?? "—";
    return `<tr class="${you ? "is-you" : ""}">
      <td class="lb-rank">${i + 1}</td>
      <td><div class="lb-name"><img src="${p.photoURL || ""}" onerror="this.style.display='none'"><span>${p.displayName}${you ? " (you)" : ""}</span></div></td>
      <td class="lb-stat" style="color:var(--cyan);font-weight:700;text-shadow:0 0 10px var(--cyan-glow);">${time}</td>
      <td class="lb-stat" style="color:var(--accent);font-weight:700;text-shadow:0 0 10px var(--accent-glow);">${streak}</td>
    </tr>`;
  }).join("");
  document.getElementById("practice-table").style.display = "table";
}