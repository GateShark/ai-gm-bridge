// 0.9.2: "Copy bot setup prompt". The text lives in docs/bot-setup-prompt.md inside the module (swap that one file to
// change it). Everything above the first line that is only "---" is a note for the human; everything below is the block
// to paste into the bot. Loaded on demand (GM clicks the button), never at startup, so it costs nothing during play.
export const SETUP_GUIDE_URL = "https://github.com/GateShark/ai-gm-bridge/blob/main/docs/SETUP.md"; // 0.9.3: linked from the settings
export const PROMPT_FILE = "docs/bot-setup-prompt.md";
export const PLACEHOLDER_MARK = "AIGM-PLACEHOLDER";
export const promptUrl = (id = "ai-gm-bridge", getRoute = globalThis.foundry?.utils?.getRoute) => {
  const path = `modules/${id}/${PROMPT_FILE}`;
  try { return typeof getRoute === "function" ? getRoute(path) : `/${path}`; } catch { return `/${path}`; }
};
export function splitPrompt(text) {
  const raw = String(text ?? "").replace(/\r\n/g, "\n");
  const m = raw.match(/^---[ \t]*$/m);
  if (!m) return { intro: "", body: raw.trim(), placeholder: raw.includes(PLACEHOLDER_MARK) };
  const intro = raw.slice(0, m.index).trim();
  const body = raw.slice(m.index + m[0].length).trim();
  return { intro, body, placeholder: raw.includes(PLACEHOLDER_MARK) };
}
export async function loadSetupPrompt({ fetchImpl = (...a) => globalThis.fetch(...a), url = promptUrl() } = {}) {
  const res = await fetchImpl(url, { cache: "no-cache" });
  if (!res?.ok) throw new Error(`could not load ${PROMPT_FILE} (${res?.status ?? "no response"})`);
  return splitPrompt(await res.text());
}
// Clipboard first (needs a secure page and a recent click), then the old execCommand route on the textarea.
export async function copyText(text, { clipboard = globalThis.navigator?.clipboard, textarea = null, doc = globalThis.document } = {}) {
  try { if (clipboard?.writeText) { await clipboard.writeText(text); return true; } } catch {}
  try {
    if (textarea) { textarea.focus?.(); textarea.select?.(); if (doc?.execCommand?.("copy")) return true; }
  } catch {}
  return false;
}
