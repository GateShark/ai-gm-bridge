// Pure leader-election logic (no Foundry globals). D1: bot-preferred, heartbeat, one takeover per timeout.
export function decideLeader({ now, selfId, selfIsBot, selfIsGM, state, timeoutMs }) {
  // state: { leaderId, term, lastBeat, lastTermChange, leaderIsBot }
  if (!selfIsGM) return { action: "passive" };
  const s = state ?? { leaderId: null, term: 0, lastBeat: 0, lastTermChange: 0, leaderIsBot: false };
  if (s.leaderId === selfId) return { action: "lead", term: s.term };
  const stale = !s.leaderId || now - s.lastBeat > timeoutMs;
  if (selfIsBot) {
    // bot reclaims whenever current leader is not a bot or is stale
    if (stale || !s.leaderIsBot) return { action: "claim", term: s.term + 1 };
    return { action: "passive" };
  }
  // non-bot GM: only take over when stale and no takeover in the last timeout window
  if (stale && now - s.lastTermChange > timeoutMs) return { action: "claim", term: s.term + 1 };
  return { action: "passive" };
}

// Apply an observed heartbeat; higher term wins, ties broken by bot-ness then userId.
export function applyHeartbeat(state, hb, now) {
  const s = state ?? { leaderId: null, term: 0, lastBeat: 0, lastTermChange: 0, leaderIsBot: false };
  if (hb.term < s.term) return s;
  if (hb.term === s.term && s.leaderId && hb.userId !== s.leaderId) {
    const better = (hb.isBot && !s.leaderIsBot) || (hb.isBot === s.leaderIsBot && hb.userId < s.leaderId);
    if (!better) return s;
  }
  const changed = hb.term !== s.term || hb.userId !== s.leaderId;
  return { leaderId: hb.userId, term: hb.term, lastBeat: now, leaderIsBot: !!hb.isBot,
           lastTermChange: changed ? now : s.lastTermChange };
}
