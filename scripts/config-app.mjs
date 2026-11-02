// GM-only settings form: bot user, delivery (relay/direct), webhook, filters. The secret is write-only in this form.
const ID = "ai-gm-bridge";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const FIELDS = [
  ["botNames", "text", "Names that count as addressing the AI GM (comma list)"],
  ["delivery", "select", "Delivery: relay (external process) or direct (bot GM browser POSTs)", ["relay", "direct"]],
  ["webhookUrl", "text", "Webhook URL (direct mode; the relay uses its own env)"],
  ["webhookAuthHeader", "text", "Auth header name"],
  ["wakeOn", "text", "Wake on: mention, whisper, keyword, question, ic"],
  ["keywords", "text", "Extra wake keywords (comma list)"],
  ["ignoreUsers", "text", "Never wake for these users (comma list)"],
  ["ignoreOOC", "checkbox", "Ignore OOC (( )) / ooc / //"],
  ["ignorePlainRolls", "checkbox", "Ignore rolls without a question"],
  ["minChars", "number", "Min characters to wake"],
  ["debounceMs", "number", "Debounce ms (one wake per burst)"],
  ["maxWaitMs", "number", "Max wait ms"],
  ["localCommands", "checkbox", "Handle !roll !music !scene !hp !luck locally"],
  ["ttsMinChars", "number", "Replies shorter than this skip TTS (0 = off)"],
];
export function makeConfigApp() {
  const { ApplicationV2 } = foundry.applications.api;
  return class AIGMConfig extends ApplicationV2 {
    static DEFAULT_OPTIONS = { id: "aigm-config", tag: "form", window: { title: "AI GM Bridge settings" }, position: { width: 520 },
      form: { handler: AIGMConfig.#save, closeOnSubmit: true } };
    async _renderHTML() {
      const g = (k) => game.settings.get(ID, k);
      const gms = game.users.filter(u => u.isGM);
      const row = ([k, type, label, opts]) => {
        const v = g(k);
        const input = type === "checkbox" ? `<input type="checkbox" name="${k}" ${v ? "checked" : ""}>`
          : type === "select" ? `<select name="${k}">${opts.map(o => `<option ${o === v ? "selected" : ""}>${o}</option>`).join("")}</select>`
          : `<input type="${type}" name="${k}" value="${esc(v)}">`;
        return `<div class="form-group"><label>${esc(label)}</label><div class="form-fields">${input}</div></div>`;
      };
      const hasSecret = !!g("webhookSecret");
      return `<section class="standard-form" style="padding:8px">
        <div class="form-group"><label>Bot GM user (preferred leader, runs commands)</label><div class="form-fields"><select name="botUserId">
          <option value="">(none)</option>${gms.map(u => `<option value="${u.id}" ${u.id === g("botUserId") ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></div></div>
        ${FIELDS.map(row).join("")}
        <div class="form-group"><label>Webhook secret (direct mode)</label><div class="form-fields">
          <input type="password" name="webhookSecret" autocomplete="new-password" placeholder="${hasSecret ? "set — leave blank to keep" : "not set"}"></div>
          <p class="hint">Write-only here. World settings are readable by scripts of any logged-in user, so prefer the relay (env-only secret) for shared worlds.</p></div>
        <label><input type="checkbox" name="clearSecret"> Clear stored secret</label>
        <footer class="form-footer"><button type="submit">Save</button></footer></section>`;
    }
    _replaceHTML(html, content) { content.innerHTML = html; }
    static async #save(event, form, fd) {
      if (!game.user.isGM) return;
      const d = fd.object;
      for (const [k, type] of [["botUserId", "text"], ...FIELDS]) {
        const v = type === "checkbox" ? !!d[k] : type === "number" ? Number(d[k]) : String(d[k] ?? "");
        if (type === "number" && !Number.isFinite(v)) continue;
        await game.settings.set(ID, k, v);
      }
      if (d.clearSecret) await game.settings.set(ID, "webhookSecret", "");
      else if (d.webhookSecret) await game.settings.set(ID, "webhookSecret", String(d.webhookSecret));
    }
  };
}
