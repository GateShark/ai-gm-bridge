// v0.7.2: the context journal list is NOT stored in the world any more. Foundry v14 syncs every journal (even ownership
// NONE) and every world setting to player browsers, so nothing stored there is secret. This only removes what v0.7.0/0.7.1 left behind.
export const ID = "ai-gm-bridge";
export const CONFIG_NAME = "AI GM Config";
export const findConfig = (g) => g.journal?.find?.(j => j.flags?.[ID]?.gmConfig === true) ?? null;
// Clears the old world setting and the v0.7.1 "AI GM Config" journal (deleted if it is ours and has no pages, else the flag is unset).
export async function cleanupContextJournals(g) {
  if (!g.user?.isGM) return { cleared: false };
  let old = ""; try { old = String(g.settings.get(ID, "contextJournals") ?? ""); } catch {}
  let cleared = false;
  if (old) { await g.settings.set(ID, "contextJournals", ""); cleared = true; }
  const j = findConfig(g);
  if (j) {
    const v = String(j.flags?.[ID]?.contextJournals ?? ""); if (v) old = [old, v].filter(Boolean).join(", ");
    if (!(j.pages?.size ?? j.pages?.contents?.length ?? 0)) await j.delete(); else await j.unsetFlag(ID, "contextJournals");
    cleared = true;
  }
  return { cleared, old };
}
