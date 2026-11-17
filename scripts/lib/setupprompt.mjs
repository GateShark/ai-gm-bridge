// 0.9.2: "Copy bot setup prompt". The text lives in docs/bot-setup-prompt.md inside the module (swap that one file to
// change it). Everything above the first line that is only "---" is a note for the human; everything below is the block
// to paste into the bot. Loaded on demand (GM clicks the button), never at startup, so it costs nothing during play.
// 0.9.3: linked from the settings. 0.9.6: it points at the copy bundled in the module (always there, matches the installed
// version), not at GitHub main, which does not have the file until the repository is pushed.
export const GUIDE_FILE = "docs/SETUP.md";
export const SETUP_GUIDE_URL = `modules/ai-gm-bridge/${GUIDE_FILE}`;
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

// 0.9.6: the link's real address (Foundry route, so a sub-path install works) and a click handler that shows the guide as plain
// text in a new tab (a browser may download a .md file instead of showing it). If the fetch fails the link just opens the file.
export const guideHref = (getRoute = globalThis.foundry?.utils?.getRoute) => { try { return typeof getRoute === "function" ? getRoute(SETUP_GUIDE_URL) : `/${SETUP_GUIDE_URL}`; } catch { return `/${SETUP_GUIDE_URL}`; } };
export async function openSetupGuide(ev, { fetchImpl = (...a) => globalThis.fetch(...a), open = (...a) => globalThis.open?.(...a), blobUrl = (t) => globalThis.URL.createObjectURL(new globalThis.Blob([t], { type: "text/plain;charset=utf-8" })), href = guideHref() } = {}) {
  try {
    ev?.preventDefault?.();
    const res = await fetchImpl(href, { cache: "no-cache" });
    if (!res?.ok) throw new Error(String(res?.status ?? "no response"));
    return !!open(blobUrl(await res.text()), "_blank", "noopener");
  } catch { try { return !!open(href, "_blank", "noopener"); } catch { return false; } }
}
export const bindSetupGuideLinks = (root) => { try { for (const a of root?.querySelectorAll?.("[data-aigm-guide]") ?? []) a.addEventListener("click", (ev) => { openSetupGuide(ev); }); } catch {} };
