// 0.8.8 in-game GM panel: pause/resume, redo/skip last reply, recap, current
// turn, pending roll cancel, and a quick HP list. Pure helpers are exported
// for tests; the ApplicationV2 wrapper is created only when Foundry is present.
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const get = (o, p) => String(p ?? "").split(".").reduce((x, k) => x?.[k], o);

export function collectHp(actors, { hpPath = "system.attributes.hp.value" } = {}) {
  const list = [];
  for (const a of actors ?? []) {
    const hpObj = a?.system?.attributes?.hp;
    let value, max;
    if (hpObj && typeof hpObj === "object" && "value" in hpObj) { value = hpObj.value; max = hpObj.max ?? null; }
    else {
      const p = hpPath || "system.hp.value";
      value = get(a, p);
      max = get(a, p.replace(/\.value$/, ".max"));
    }
    if (value == null && max == null) continue;
    list.push({ id: a.id, name: a.name, value: value ?? null, max: max ?? null, pc: !!a.hasPlayerOwner });
  }
  return list.sort((a, b) => (Number(b.pc) - Number(a.pc)) || String(a.name ?? "").localeCompare(String(b.name ?? "")));
}

export function makeControlEvent(action, extra = {}, now = Date.now()) {
  return { eventId: `control:${action}:${now}`, type: "control", action, ...extra };
}

export function panelHtml({ paused = false, turn = null, pending = [], hp = [], recapText = "", t = (k, f) => f || k } = {}) {
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
    return `<div class="aigm-hp-row" data-actor-id="${esc(h.id)}"><span>${esc(h.name)}${h.pc ? " ★" : ""}</span>` +
      `<span class="aigm-hp-bar" title="${esc(h.value)}/${esc(h.max ?? "?")}"><span style="width:${pct}%"></span></span>` +
      `<span>${esc(h.value)}${h.max != null ? `/${esc(h.max)}` : ""}</span></div>`;
  }).join("") || `<p class="hint">${esc(t("AIGM.panel.noHp", "No actors with HP."))}</p>`;
  return `<section class="aigm-panel">
    <div class="aigm-panel-actions">
      <button type="button" data-aigm-action="${paused ? "resume" : "pause"}">${esc(paused ? t("AIGM.panel.resume", "Resume AI GM") : t("AIGM.panel.pause", "Pause AI GM"))}</button>
      <button type="button" data-aigm-action="redo">${esc(t("AIGM.panel.redo", "Redo last reply"))}</button>
      <button type="button" data-aigm-action="skip">${esc(t("AIGM.panel.skip", "Skip last reply"))}</button>
      <button type="button" data-aigm-action="recap">${esc(t("AIGM.panel.recap", "Recap"))}</button>
    </div>
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
