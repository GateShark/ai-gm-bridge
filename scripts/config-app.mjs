// GM-only settings form: Basic page + collapsed Advanced. The secret is write-only here.
import { BASIC_FIELDS, ADVANCED_FIELDS, testConnection } from "./lib/settingsui.mjs";
import { liveSetupCheck, formatConnectionWithSetup } from "./lib/setupcheck.mjs";
import { runLinkProbe, formatLinkCheckLine, presenceSnapshot } from "./lib/presence.mjs";
import { TTS_VOICES, resolveTtsVoice, playVoicePreview } from "./lib/voices.mjs";
const ID = "ai-gm-bridge";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ALL_FIELDS = [...BASIC_FIELDS, ...ADVANCED_FIELDS];

export function makeConfigApp() {
  const { ApplicationV2 } = foundry.applications.api;
  return class AIGMConfig extends ApplicationV2 {
    static DEFAULT_OPTIONS = { id: "aigm-config", tag: "form", window: { title: "AI GM Pirate Borg settings" }, position: { width: 560 },
      form: { handler: AIGMConfig.#save, closeOnSubmit: true } };
    async _renderHTML() {
      const g = (k) => game.settings.get(ID, k);
      const t = (k, f) => { const v = game.i18n?.localize?.(k); return v && v !== k ? v : (f || k); };
      const labelFor = (k, fallback) => t(`AIGM.settings.${k}.name`, fallback || ({ delivery: "Delivery", webhookUrl: "Webhook URL", botNames: "Bot names", webhookAuthHeader: "Webhook auth header" }[k]));
      const gms = game.users.filter(u => u.isGM);
      const row = ([k, type, opts]) => {
        const v = g(k);
        const input = type === "checkbox" ? `<input type="checkbox" name="${k}" ${v ? "checked" : ""}>`
          : type === "select" ? `<select name="${k}">${opts.map(o => `<option ${o === v ? "selected" : ""}>${o}</option>`).join("")}</select>`
          : type === "voice" ? (() => {
            const cur = resolveTtsVoice(v);
            const optsHtml = TTS_VOICES.map(voice => `<option value="${esc(voice.id)}" ${voice.id === cur ? "selected" : ""}>${esc(voice.label)}</option>`).join("");
            return `<select name="${k}">${optsHtml}</select><button type="button" data-aigm-voice-preview>${esc(t("AIGM.config.playVoiceSample", "Play sample"))}</button>`;
          })()
          : type === "textarea" ? `<textarea name="${k}" rows="6">${esc(v)}</textarea>`
          : type === "number" && k === "voiceVolume" ? `<input type="number" name="${k}" min="0" max="100" step="1" value="${esc(v)}">`
          : `<input type="${type}" name="${k}" value="${esc(v)}">`;
        return `<div class="form-group"><label>${esc(labelFor(k))}</label><div class="form-fields">${input}</div></div>`;
      };
      const hasSecret = !!g("webhookSecret");
      return `<section class="standard-form aigm-config" style="padding:8px">
        <h3>${esc(t("AIGM.config.basic", "Basic"))}</h3>
        <div class="form-group"><label>${esc(labelFor("enabled"))}</label><div class="form-fields"><input type="checkbox" name="enabled" ${g("enabled") ? "checked" : ""}></div></div>
        <div class="form-group"><label>${esc(t("AIGM.config.botUser", "Bot GM user (preferred leader, runs commands)"))}</label><div class="form-fields"><select name="botUserId">
          <option value="">(none)</option>${gms.map(u => `<option value="${u.id}" ${u.id === g("botUserId") ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></div></div>
        ${BASIC_FIELDS.filter(([k]) => k !== "enabled" && ["delivery", "webhookUrl"].includes(k)).map(row).join("")}
        <div class="form-group"><label>${esc(t("AIGM.config.webhookSecret", "Webhook secret (direct mode)"))}</label><div class="form-fields">
          <input type="password" name="webhookSecret" autocomplete="new-password" placeholder="${hasSecret ? "set — leave blank to keep" : "not set"}"></div>
          <p class="hint">${esc(t("AIGM.config.secretHint", "Write-only here. World settings are readable by scripts of any logged-in user, so prefer the relay (env-only secret) for shared worlds."))}</p></div>
        <label><input type="checkbox" name="clearSecret"> ${esc(t("AIGM.config.clearSecret", "Clear stored secret"))}</label>
        ${BASIC_FIELDS.filter(([k]) => !["enabled", "delivery", "webhookUrl"].includes(k)).map(row).join("")}
        <div class="form-group" style="margin-top:8px">
          <button type="button" data-aigm-test>${esc(t("AIGM.config.testConnection", "Test connection"))}</button>
          <span data-aigm-test-status></span>
        </div>
        <details class="aigm-advanced">
          <summary>${esc(t("AIGM.config.advanced", "Advanced"))}</summary>
          ${ADVANCED_FIELDS.map(row).join("")}
        </details>
        <footer class="form-footer"><button type="submit">${esc(t("AIGM.config.save", "Save"))}</button></footer></section>`;
    }
    _replaceHTML(html, content) {
      content.innerHTML = html;
      content.querySelector("[data-aigm-voice-preview]")?.addEventListener("click", (ev) => {
        ev.preventDefault();
        playVoicePreview(content.querySelector("[name=ttsVoice]")?.value);
      });
      content.querySelector("[name=ttsVoice]")?.addEventListener("change", (ev) => {
        const id = ev.target?.value;
        try { game.settings.set(ID, "ttsVoice", id); } catch { playVoicePreview(id); }
      });
      content.querySelector("[data-aigm-test]")?.addEventListener("click", async (ev) => {
        ev.preventDefault();
        const status = content.querySelector("[data-aigm-test-status]");
        const t = (k, f) => { const v = game.i18n?.localize?.(k); return v && v !== k ? v : (f || k); };
        if (status) { status.textContent = t("AIGM.config.testing", "Testing…"); status.dataset.ok = ""; }
        const url = content.querySelector("[name=webhookUrl]")?.value ?? game.settings.get(ID, "webhookUrl");
        const typed = content.querySelector("[name=webhookSecret]")?.value;
        const secret = typed || game.settings.get(ID, "webhookSecret");
        const header = content.querySelector("[name=webhookAuthHeader]")?.value || game.settings.get(ID, "webhookAuthHeader") || "Authorization";
        const botId = content.querySelector("[name=botUserId]")?.value || game.settings.get(ID, "botUserId");
        const bot = game.users.get(botId) ?? game.users.find(u => u.isGM && botId && u.id === botId);
        const r = await testConnection({ url, secret, header, botActive: bot ? !!bot.active : null });
        const setup = liveSetupCheck({ scene: globalThis.canvas?.scene ?? game.scenes?.viewed, combat: game.combat, users: game.users?.contents ?? [] });
        let linkLine = "";
        try {
          const userId = game.user?.id ?? "";
          const probe = await runLinkProbe({
            userId,
            isBotWriter: !!(userId && botId && userId === botId),
            setSetting: (v) => game.settings.set(ID, "linkProbe", v),
            getSetting: () => game.settings.get(ID, "linkProbe")
          });
          let stored = null;
          try { stored = game.settings.get(ID, "linkProbe"); } catch {}
          const presence = presenceSnapshot({
            now: Date.now(), worldId: game.world?.id ?? null, botUser: bot,
            probe: stored, botUserId: botId
          });
          linkLine = formatLinkCheckLine(probe, presence, t);
        } catch (e) {
          linkLine = formatLinkCheckLine({ ok: false, error: e?.message || "Link check failed" }, {}, t);
        }
        if (status) {
          const base = r.ok ? (r.message || t("AIGM.config.testOk", "OK")) : (r.error || t("AIGM.config.testFail", "Failed"));
          const combined = [formatConnectionWithSetup({ ...r, message: base, error: base }, setup), linkLine].filter(Boolean).join(" ");
          status.textContent = combined;
          status.dataset.ok = r.ok ? "1" : "0";
        }
      });
    }
    static async #save(event, form, fd) {
      if (!game.user.isGM) return;
      const d = fd.object;
      for (const [k, type] of [["botUserId", "text"], ["enabled", "checkbox"], ...ALL_FIELDS]) {
        const v = type === "checkbox" ? !!d[k] : type === "number" ? Number(d[k]) : String(d[k] ?? "");
        if (type === "number" && !Number.isFinite(v)) continue;
        await game.settings.set(ID, k, v);
      }
      if (d.clearSecret) await game.settings.set(ID, "webhookSecret", "");
      else if (d.webhookSecret) await game.settings.set(ID, "webhookSecret", String(d.webhookSecret));
    }
  };
}
