function serializeRoom(room) {
  const obj = room.toObject();
  obj.players = Object.fromEntries(room.players);
  obj.rounds  = obj.rounds.map(r => ({
    ...r,
    skipVotes: r.skipVotes instanceof Map ? Object.fromEntries(r.skipVotes) : (r.skipVotes || {})
  }));
  return obj;
}

module.exports = { serializeRoom };
