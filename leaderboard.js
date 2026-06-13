import { requireUsername } from './session.js';

const session = requireUsername();
if (!session) throw new Error('redirecting');

const { token, user } = session;

// ── Tab switching ─────────────────────────────────────────────
let activeTab = 'competitive';

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    activeTab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${activeTab}`));
    load();
  });
});

document.getElementById('refresh-btn').addEventListener('click', load);

load();

async function load() {
  if (activeTab === 'competitive') loadCompetitive();
  else                             loadPractice();
}

// ── Competitive ───────────────────────────────────────────────
async function loadCompetitive() {
  const loading = document.getElementById('loading-comp');
  const empty   = document.getElementById('empty-comp');
  const table   = document.getElementById('lb-table');
  loading.style.display = 'block';
  table.style.display   = 'none';
  empty.style.display   = 'none';

  let players;
  try {
    const res = await fetch('/api/players', { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    players = data.players;
  } catch (err) {
    loading.style.display = 'none';
    empty.style.display   = 'block';
    empty.textContent     = 'Could not load leaderboard.';
    console.error(err);
    return;
  }

  loading.style.display = 'none';
  if (!players.length) { empty.style.display = 'block'; return; }

  document.getElementById('lb-body').innerHTML = players.map((p, i) => {
    const winPct = p.roundsPlayed > 0 ? Math.round((p.wins / p.roundsPlayed) * 100) : 0;
    const you    = p.googleId === user.googleId;
    return `<tr class="${you ? 'is-you' : ''}">
      <td class="lb-rank">${i + 1}</td>
      <td><div class="lb-name">
        <img src="${p.photoURL || ''}" onerror="this.style.display='none'">
        @${p.username || p.displayName}${you ? ' (you)' : ''}
      </div></td>
      <td class="lb-rating">${p.rating ?? 1200}</td>
      <td class="lb-stat">${p.wins ?? 0}</td>
      <td class="lb-stat">${p.roundsPlayed ?? 0}</td>
      <td class="lb-stat">${winPct}%</td>
    </tr>`;
  }).join('');

  table.style.display = 'table';
}

// ── Practice ──────────────────────────────────────────────────
async function loadPractice() {
  const loading = document.getElementById('loading-prac');
  const empty   = document.getElementById('empty-prac');
  const table   = document.getElementById('prac-table');
  loading.style.display = 'block';
  table.style.display   = 'none';
  empty.style.display   = 'none';

  let players;
  try {
    const res = await fetch('/api/players/practice', { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    players = data.players;
  } catch (err) {
    loading.style.display = 'none';
    empty.style.display   = 'block';
    empty.textContent     = 'Could not load practice scores.';
    console.error(err);
    return;
  }

  loading.style.display = 'none';
  if (!players.length) { empty.style.display = 'block'; return; }

  document.getElementById('prac-body').innerHTML = players.map((p, i) => {
    const you     = p.googleId === user.googleId;
    const bestSec = p.practiceStats?.bestTimeMs != null
      ? (p.practiceStats.bestTimeMs / 1000).toFixed(1) + 's'
      : '—';
    const streak  = p.practiceStats?.bestStreak ?? 0;
    return `<tr class="${you ? 'is-you' : ''}">
      <td class="lb-rank">${i + 1}</td>
      <td><div class="lb-name">
        <img src="${p.photoURL || ''}" onerror="this.style.display='none'">
        @${p.username || p.displayName}${you ? ' (you)' : ''}
      </div></td>
      <td class="lb-rating">${bestSec}</td>
      <td class="lb-stat">${streak}</td>
    </tr>`;
  }).join('');

  table.style.display = 'table';
}
