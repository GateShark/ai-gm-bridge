// 0.8.8 in-game GM panel: pause/resume, redo/skip last reply, recap, current
// turn, pending roll cancel, and a quick HP list. Pure helpers are exported
// for tests; the ApplicationV2 wrapper is created only when Foundry is present.
import { readActorHp } from "./hp.mjs";
import { formatPanelLink } from "./presence.mjs";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function sceneTokens(scene) {
  const col = scene?.tokens;
  if (!col) return [];
  if (Array.isArray(col)) return col.filter(Boolean);
  if (Array.isArray(col.contents)) return col.contents.filter(Boolean);
  try { return [...col].filter(Boolean); } catch { return []; }
}
// Tokens on the viewed scene. Prefer token.actor so unlinked tokens show their own HP (including 0).
// Bare actors (no .actor) still work so older callers/tests keep passing.
export function collectHp(tokens, { hpPath = "system.attributes.hp.value" } = {}) {
  const list = [];
  for (const t of tokens ?? []) {
    const actor = t?.actor ?? (t?.system ? t : null);
    if (!actor) continue;
    const hp = readActorHp(actor, hpPath);
    if (!hp || (hp.value == null && hp.max == null)) continue;
    list.push({ id: t.id ?? actor.id, name: t.name || actor.name, value: hp.value ?? null, max: hp.max ?? null, pc: !!(actor.hasPlayerOwner ?? t.hasPlayerOwner) });
  }
  return list.sort((a, b) => (Number(b.pc) - Number(a.pc)) || String(a.name ?? "").localeCompare(String(b.name ?? "")));
}
export function stuckCounts(counts = {}) {
  const src = counts && typeof counts === "object" ? counts : {};
  const q = Math.max(0, Number(src.queued) || 0);
  const d = Math.max(0, Number(src.dead) || 0);
  return { queued: q, dead: d, total: q + d };
}
export function formatStuckCount(counts, t = (k, f) => f || k) {
  const c = stuckCounts(counts);
  if (!c.total) return t("AIGM.panel.noStuck", "No stuck events.");
  return t("AIGM.panel.stuckCount", "{total} stuck ({queued} queued, {dead} dead).")
    .replace("{total}", String(c.total)).replace("{queued}", String(c.queued)).replace("{dead}", String(c.dead));
}
export function formatClearedStuck(n, t = (k, f) => f || k) {
  return t("AIGM.panel.clearedStuck", "Cleared {n} stuck event(s).").replace("{n}", String(Number(n) || 0));
}

export function makeControlEvent(action, extra = {}, now = Date.now()) {
  return { eventId: `control:${action}:${now}`, type: "control", action, ...extra };
}
// Redo/skip targets: prefer the last wake, then any ids the caller sent, then newest player chat.
export function resolveWakeEventIds(lastWake, requested, fallback) {
  const fromLast = (lastWake?.eventIds ?? []).filter(Boolean);
  if (fromLast.length) return fromLast;
  const fromReq = (requested ?? []).filter(Boolean);
  if (fromReq.length) return fromReq;
  if (typeof fallback === "function") return fallback() ?? [];
  return fallback ?? [];
}
export function newestChatEventIds(messages = [], { limit = 5, skip } = {}) {
  const out = [];
  const n = Math.max(0, Number(limit) || 0);
  for (let i = (messages?.length ?? 0) - 1; i >= 0 && out.length < n; i--) {
    const m = messages[i];
    if (!m?.id || skip?.(m)) continue;
    const id = String(m.id);
    out.push(id.startsWith("chat:") ? id : `chat:${id}`);
  }
  return out;
}

export const PANEL_LOGO_SRC = "modules/ai-gm-bridge/assets/logo-256.webp";

export function panelHtml({ paused = false, turn = null, pending = [], hp = [], recapText = "", stuck = null, setup = null, link = null, logoSrc = PANEL_LOGO_SRC, t = (k, f) => f || k } = {}) {
  const turnLine = turn?.name
    ? (t("AIGM.panel.turnLine", "Round {round}: {name} is up.").replace("{round}", turn.round ?? "?").replace("{name}", turn.name) + (turn.next ? ` ${t("AIGM.panel.next", "Next: {name}.").replace("{name}", turn.next)}` : ""))
    : t("AIGM.panel.noCombat", "No active combat.");
  const rolls = (pending ?? []).map(r => {
    const label = r.label || r.formula || r.stat || r.id;
    const dr = r.dr != null ? ` DR ${r.dr}` : "";
    return `<div class="aigm-roll-row" data-request-id="${esc(r.id)}"><span>${esc(r.actorName ?? "")}: ${esc(label)}${esc(dr)}</span>` +
      `<button type="button" data-aigm-action="cancelRoll" data-request-id="${esc(r.id)}">${esc(t("AIGM.panel.cancelRoll", "Cancel"))}</button></div>`;
  }).join("") || `<p class="hint">${esc(t("AIGM.panel.noRolls", "No pending rolls."))}</p>`;
  const hps = (hp ?? []).map(h => {
    const pct = h.max ? Math.max(0, Math.min(100, Math.round((Number(h.value) / Number(h.max)) * 100))) : 0;
    return `<div class="aigm-hp-row${h.value != null && Number(h.value) <= 0 ? " aigm-hp-dead" : ""}" data-actor-id="${esc(h.id)}"><span>${esc(h.name)}${h.pc ? " ★" : ""}</span>` +
      `<span class="aigm-hp-bar" title="${esc(h.value)}/${esc(h.max ?? "?")}"><span style="width:${pct}%"></span></span>` +
      `<span>${esc(h.value)}${h.max != null ? `/${esc(h.max)}` : ""}</span></div>`;
  }).join("") || `<p class="hint">${esc(t("AIGM.panel.noHp", "No tokens with HP on this scene."))}</p>`;
  const linkLine = formatPanelLink(link, t);
  return `<section class="aigm-panel">
    <div class="aigm-panel-brand">
      <img class="aigm-panel-logo" src="${esc(logoSrc)}" width="32" height="32" alt="">
      ${linkLine ? `<p class="aigm-panel-link">${esc(linkLine)}</p>` : ""}
    </div>
    <div class="aigm-panel-actions">
      <button type="button" data-aigm-action="${paused ? "resume" : "pause"}">${esc(paused ? t("AIGM.panel.resume", "Resume AI GM") : t("AIGM.panel.pause", "Pause AI GM"))}</button>
      <button type="button" data-aigm-action="redo">${esc(t("AIGM.panel.redo", "Redo last reply"))}</button>
      <button type="button" data-aigm-action="skip">${esc(t("AIGM.panel.skip", "Skip last reply"))}</button>
      <button type="button" data-aigm-action="recap">${esc(t("AIGM.panel.recap", "Recap"))}</button>
      <button type="button" data-aigm-action="clearStuck"${stuckCounts(stuck).total ? "" : " disabled"}>${esc(t("AIGM.panel.clearStuck", "Clear stuck"))}</button>
      <button type="button" data-aigm-action="setupCheck">${esc(t("AIGM.panel.setupCheck", "Check setup"))}</button>
    </div>
    ${setup?.warning ? `<div class="aigm-setup-warn" role="status">${esc(setup.warning)}</div>` : ""}
    <p class="aigm-panel-stuck">${esc(formatStuckCount(stuck, t))}</p>
    <h3>${esc(t("AIGM.panel.turn", "Current turn"))}</h3>
    <p class="aigm-panel-turn">${esc(turnLine)}</p>
    <h3>${esc(t("AIGM.panel.pendingRolls", "Pending rolls"))}</h3>
    <div class="aigm-panel-rolls">${rolls}</div>
    <h3>${esc(t("AIGM.panel.hp", "HP"))}</h3>
    <div class="aigm-panel-hp">${hps}</div>
    <pre class="aigm-panel-recap"${recapText ? "" : " hidden"}>${esc(recapText)}</pre>
  </section>`;
}

export function installSidebarButton({ doc, label = "AI GM", open } = {}) {
  if (!doc || doc.getElementById("aigm-sidebar-btn")) return false;
  const nav = doc.getElementById("sidebar-tabs")
    || doc.querySelector?.("#sidebar .tabs, #sidebar menu.tabs, #sidebar nav, aside#sidebar .tabs, #sidebar-content, #sidebar");
  const btn = doc.createElement("button");
  btn.type = "button"; btn.id = "aigm-sidebar-btn"; btn.className = "item";
  btn.title = label; btn.setAttribute?.("aria-label", label);
  btn.innerHTML = `<i class="fas fa-robot"></i>`;
  btn.addEventListener("click", (ev) => { ev.preventDefault?.(); ev.stopPropagation?.(); open?.(); });
  if (nav?.appendChild) { nav.appendChild(btn); btn.dataset.where = "sidebar"; return true; }
  if (!doc.body) return false;
  btn.style.cssText = "position:fixed;right:16px;bottom:52px;z-index:10000;width:36px;height:36px;border-radius:50%;cursor:pointer";
  doc.body.appendChild(btn); btn.dataset.where = "floating"; return true;
}

export function makeGmPanel(deps = {}) {
  const { ApplicationV2 } = foundry.applications.api;
  const t = deps.t || ((k, f) => f || k);
  return class AIGMPanel extends ApplicationV2 {
    static DEFAULT_OPTIONS = { id: "aigm-panel", tag: "div", window: { title: "AI GM", icon: "fas fa-robot" }, position: { width: 380, height: "auto" } };
    recapText = "";
    async _renderHTML() {
      const state = deps.gather ? deps.gather() : {};
      return panelHtml({ ...state, recapText: this.recapText, t });
    }
    _replaceHTML(html, content) {
      content.innerHTML = html;
      content.querySelectorAll("[data-aigm-action]").forEach(btn => {
        btn.addEventListener("click", async (ev) => {
          ev.preventDefault();
          const action = btn.dataset.aigmAction;
          if (action === "clearStuck") {
            const n = stuckCounts(deps.gather?.()?.stuck).total;
            if (n > 0) {
              const msg = t("AIGM.panel.clearStuckConfirm", "Clear {n} stuck event(s) that were never marked received?").replace("{n}", String(n));
              const yes = deps.confirm ? await deps.confirm(msg) : (typeof globalThis.confirm === "function" ? globalThis.confirm(msg) : true);
              if (!yes) return;
            }
          }
          const result = await deps.onAction?.(action, { requestId: btn.dataset.requestId });
          if (action === "recap" && result) {
            this.recapText = typeof result === "string" ? result : [result.summary, ...(result.lines ?? [])].filter(Boolean).join("\n");
          }
          this.render();
        });
      });
    }
  };
}
