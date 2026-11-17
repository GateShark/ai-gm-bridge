// GM-only settings menu: shows the bot setup prompt in a selectable box and copies it to the clipboard.
import { loadSetupPrompt, copyText } from "./lib/setupprompt.mjs";
const ID = "ai-gm-bridge";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const t = (k, f) => { const v = game.i18n?.localize?.(k); return v && v !== k ? v : f; };

export function makeSetupPromptApp() {
  const { ApplicationV2 } = foundry.applications.api;
  return class AIGMSetupPrompt extends ApplicationV2 {
    static DEFAULT_OPTIONS = { id: "aigm-setup-prompt", tag: "div", window: { title: "AI GM bot setup prompt", resizable: true }, position: { width: 640, height: 560 } };
    async _renderHTML() {
      if (!game.user?.isGM) return `<section style="padding:8px"><p>${esc(t("AIGM.setupPrompt.gmOnly", "GM only."))}</p></section>`;
      let p;
      try { p = await loadSetupPrompt(); } catch (e) { return `<section style="padding:8px"><p>${esc(e?.message ?? "load failed")}</p></section>`; }
      this._prompt = p;
      return `<section class="aigm-setup-prompt" style="padding:8px;display:flex;flex-direction:column;gap:6px;height:100%">
        ${p.placeholder ? `<p><b>${esc(t("AIGM.setupPrompt.placeholder", "Placeholder text: the real prompt has not been packaged yet."))}</b></p>` : ""}
        ${p.intro ? `<div style="white-space:pre-wrap;font-size:12px;max-height:130px;overflow:auto">${esc(p.intro)}</div>` : ""}
        <textarea readonly data-aigm-prompt style="flex:1;min-height:240px;font-family:monospace;font-size:12px">${esc(p.body)}</textarea>
        <div><button type="button" data-aigm-copy><i class="fas fa-copy"></i> ${esc(t("AIGM.setupPrompt.copy", "Copy to clipboard"))}</button> <span data-aigm-copy-status></span></div></section>`;
    }
    _replaceHTML(html, content) {
      content.innerHTML = html;
      const ta = content.querySelector("[data-aigm-prompt]"); if (!ta || !this._prompt) return;
      const status = content.querySelector("[data-aigm-copy-status]");
      const doCopy = async (auto) => {
        const okc = await copyText(this._prompt.body, { textarea: ta });
        if (okc) { if (status) status.textContent = t("AIGM.setupPrompt.copied", "Copied."); ui.notifications?.info(t("AIGM.setupPrompt.copied", "Bot setup prompt copied.")); }
        else { ta.focus(); ta.select(); if (status) status.textContent = t("AIGM.setupPrompt.manual", "Press Ctrl+C to copy the selected text."); }
        return okc;
      };
      content.querySelector("[data-aigm-copy]")?.addEventListener("click", (ev) => { ev.preventDefault(); doCopy(false); });
      ta.addEventListener("focus", () => ta.select());
      doCopy(true);
    }
  };
}
