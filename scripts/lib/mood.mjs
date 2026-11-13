// Scene mood -> Foundry playlist. The module never bundles music files.
export const MOODS = ["combat", "storm", "tavern", "explore", "tense", "calm", "none"];
export const DEFAULT_FADE_MS = 1500;

// 0.8.20 #8: lastCalm = the last non-combat mood that played (kept across fights). The state is persisted in the
// world setting moodState so a reload during a fight still knows what to go back to.
export const FALLBACK_MOOD = "calm";
const state = { current: null, saved: null, playlistId: null, lastCalm: null };
export function moodState() { return state; }
export function loadMoodState(raw) {
  const o = raw && typeof raw === "object" ? raw : {};
  for (const k of ["current", "saved", "lastCalm"]) state[k] = normalizeMood(o[k]) ?? null;
  state.playlistId = typeof o.playlistId === "string" && o.playlistId ? o.playlistId : null;
  return state;
}
export function moodSnapshot() { return { current: state.current, saved: state.saved, playlistId: state.playlistId, lastCalm: state.lastCalm }; }
export function noteMood(mood, playlistId = null) {
  const m = normalizeMood(mood);
  state.current = m; state.playlistId = playlistId ?? null;
  if (m && m !== "combat" && m !== "none") state.lastCalm = m;
  return state;
}
// Which mood a playing playlist stands for (reverse of the map, then by name). Lets a hand-started Calm count.
export function moodOfPlaylist(playlist, mapping = {}) {
  if (!playlist) return null;
  const name = String(playlist.name ?? "").toLowerCase(), id = playlist.id;
  for (const [mood, want] of Object.entries(mapping ?? {})) {
    const w = String(want ?? "").toLowerCase();
    if (w && (w === name || want === id)) return normalizeMood(mood);
  }
  return MOODS.find(m => m !== "none" && name === m) ?? MOODS.find(m => m !== "none" && name.includes(m)) ?? null;
}
// Combat start: save what is playing now. Uses the recorded mood, else the playing playlist, else lastCalm.
export function rememberMood({ playing = null, mapping = {} } = {}) {
  let cur = state.current && state.current !== "combat" && state.current !== "none" ? state.current : null;
  if (!cur && playing) { const m = moodOfPlaylist(playing, mapping); if (m && m !== "combat") cur = m; }
  if (!cur && state.current === "none" && !playing) { state.saved = "none"; return state.saved; } // music was turned off on purpose
  state.saved = cur || state.lastCalm || state.saved || null;
  if (cur) state.lastCalm = cur;
  return state.saved;
}
// Combat end: the saved mood, else the last non-combat mood, else calm. Silence only if music was off on purpose.
export function restoreMoodKey() {
  const v = state.saved || state.lastCalm || FALLBACK_MOOD;
  state.saved = null;
  return v;
}

export function normalizeMood(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  return MOODS.includes(s) ? s : null;
}

export function clampFadeMs(raw, fallback = DEFAULT_FADE_MS) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(60000, Math.round(n)));
}

export function parseMoodPlaylists(raw) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      const mood = normalizeMood(k);
      if (mood && mood !== "none" && v != null && String(v).trim()) out[mood] = String(v).trim();
    }
    return out;
  }
  const text = String(raw ?? "").trim();
  if (!text) return {};
  if (text.startsWith("{")) {
    try { return parseMoodPlaylists(JSON.parse(text)); } catch { /* fall through */ }
  }
  const out = {};
  for (const line of text.split(/[\n,;]+/)) {
    const m = line.match(/^\s*([a-z]+)\s*[=:]\s*(.+?)\s*$/i);
    if (!m) continue;
    const mood = normalizeMood(m[1]);
    if (mood && mood !== "none" && m[2]) out[mood] = m[2].trim();
  }
  return out;
}

function asList(playlists) {
  if (!playlists) return [];
  if (Array.isArray(playlists)) return playlists;
  if (Array.isArray(playlists.contents)) return playlists.contents;
  try { return [...playlists]; } catch { return []; }
}

export function findPlaylist(playlists, raw) {
  const want = String(raw ?? "").trim();
  if (!want) return null;
  const list = asList(playlists);
  const low = want.toLowerCase();
  return list.find(p => p.id === want || p.name === want || String(p.name || "").toLowerCase() === low) ?? null;
}

// If the GM mapped a name and it is missing, do not guess. Auto-match by name only when unmapped.
export function resolveMoodPlaylist(playlists, mood, mapping = {}) {
  const key = normalizeMood(mood);
  if (!key || key === "none") return { wanted: null, playlist: null, matched: null };
  const mapped = mapping[key];
  if (mapped) {
    return { wanted: mapped, playlist: findPlaylist(playlists, mapped), matched: "map" };
  }
  const list = asList(playlists);
  const exact = list.find(p => String(p.name || "").toLowerCase() === key);
  if (exact) return { wanted: exact.name, playlist: exact, matched: "name" };
  const part = list.find(p => String(p.name || "").toLowerCase().includes(key));
  if (part) return { wanted: part.name, playlist: part, matched: "fuzzy" };
  return { wanted: key, playlist: null, matched: null };
}

export async function fadePlaylist(pl, volume, ms) {
  if (!pl || !ms) return false;
  const sounds = [...(pl.sounds ?? [])].filter(s => s.playing || s.sound);
  await Promise.all(sounds.map(async s => {
    try {
      if (typeof s.fade === "function") await s.fade(volume, { duration: ms });
      else if (s.sound && typeof s.sound.fade === "function") await s.sound.fade(volume, { duration: ms });
    } catch {}
  }));
  return true;
}

export async function applyMood(mood, {
  playlists = [], mapping = {}, fadeMs = DEFAULT_FADE_MS, currentId = null,
  playAll = async (p) => p?.playAll?.(),
  stopAll = async (p) => p?.stopAll?.(),
  fade = fadePlaylist
} = {}) {
  const key = normalizeMood(mood);
  if (!key) return { ok: false, code: 400, error: `unknown mood ${mood}; one of ${MOODS.join(", ")}` };
  const ms = clampFadeMs(fadeMs);
  const list = asList(playlists);
  const current = (currentId && findPlaylist(list, currentId)) || list.find(p => p.playing) || null;
  if (key === "none") {
    if (current) {
      if (ms) await fade(current, 0, ms);
      await stopAll(current);
    }
    return { ok: true, mood: "none", playing: false, playlist: null, playlistId: null };
  }
  const hit = resolveMoodPlaylist(list, key, mapping);
  if (!hit.playlist) {
    const label = hit.wanted || key;
    return { ok: false, code: 404, error: `playlist not found for mood ${key}: ${label}`, mood: key, playlist: label };
  }
  const next = hit.playlist;
  if (current && current.id === next.id) {
    return { ok: true, mood: key, playing: true, playlist: next.name, playlistId: next.id, already: true, matched: hit.matched };
  }
  await playAll(next);
  if (current && current.id !== next.id) {
    if (ms) await fade(current, 0, ms);
    await stopAll(current);
  }
  return { ok: true, mood: key, playing: true, playlist: next.name, playlistId: next.id, matched: hit.matched };
}
