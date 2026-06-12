import { requireAuth } from './session.js';

const session = requireAuth();
if (!session) throw new Error('redirecting');

const { token, user } = session;

document.getElementById('refresh-btn').addEventListener('click', load);

load();

async function load() {
  document.getElementById('loading').style.display   = 'block';
  document.getElementById('lb-table').style.display  = 'none';
  document.getElementById('empty').style.display     = 'none';

  let players;
  try {
    const res = await fetch('/api/players', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    players = data.players;
  } catch (err) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('empty').style.display   = 'block';
    document.getElementById('empty').textContent     = 'Could not load leaderboard.';
    console.error(err);
    return;
  }

  document.getElementById('loading').style.display = 'none';

  if (!players.length) {
    document.getElementById('empty').style.display = 'block';
    return;
  }

  document.getElementById('lb-body').innerHTML = players.map((p, i) => {
    const winPct = p.roundsPlayed > 0 ? Math.round((p.wins / p.roundsPlayed) * 100) : 0;
    const you    = p.googleId === user.googleId;
    return `
      <tr class="${you ? 'is-you' : ''}">
        <td class="lb-rank">${i + 1}</td>
        <td><div class="lb-name">
          <img src="${p.photoURL || ''}" onerror="this.style.display='none'">
          ${p.displayName}${you ? ' (you)' : ''}
        </div></td>
        <td class="lb-rating">${p.rating ?? 1200}</td>
        <td class="lb-stat">${p.wins ?? 0}</td>
        <td class="lb-stat">${p.roundsPlayed ?? 0}</td>
        <td class="lb-stat">${winPct}%</td>
      </tr>
    `;
  }).join('');

  document.getElementById('lb-table').style.display = 'table';
}
