function expected(rA, rB) { return 1 / (1 + Math.pow(10, (rB - rA) / 400)); }

function calculateElo(ratings, winnerId, K = 32) {
  const changes = {};
  const uids = Object.keys(ratings);
  uids.forEach(uid => { changes[uid] = 0; });
  const Rw = ratings[winnerId] ?? 1200;
  uids.forEach(uid => {
    if (uid === winnerId) return;
    const Ro = ratings[uid] ?? 1200;
    changes[winnerId] += K * (1 - expected(Rw, Ro));
    changes[uid]      += K * (0 - expected(Ro, Rw));
  });
  return Object.fromEntries(Object.entries(changes).map(([uid, v]) => [uid, Math.round(v)]));
}

module.exports = { calculateElo };
