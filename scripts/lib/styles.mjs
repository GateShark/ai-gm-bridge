// 0.8.8 injected stylesheet for the status pill, PTT button, roll cards, voice replay and GM panel.
export const CSS = `
#aigm-gm-status{position:fixed;right:16px;bottom:16px;z-index:10000;padding:6px 14px 6px 12px;border-radius:999px;color:#fff;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.45);display:flex;align-items:center;gap:8px;pointer-events:auto;user-select:none}
#aigm-gm-status::before{content:"";width:8px;height:8px;border-radius:50%;background:currentColor;box-shadow:0 0 6px currentColor}
#aigm-gm-status[data-state="listening"]{background:#1b7a3a}
#aigm-gm-status[data-state="thinking"]{background:#b8860b}
#aigm-gm-status[data-state="offline"]{background:#a12b2b}
#aigm-gm-status[data-state="paused"]{background:#5a5a5a}
#aigm-ptt-button{position:fixed;left:12px;bottom:12px;z-index:100;width:48px;height:48px;border-radius:50%;border:2px solid #cfcfcf;background:#1a1a1a;color:#fff;cursor:pointer;font-size:20px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.4)}
#aigm-ptt-button .aigm-ptt-dot{position:absolute;top:6px;right:6px;width:10px;height:10px;border-radius:50%;background:#555;border:1px solid #111}
#aigm-ptt-button.aigm-ptt-live{border-color:#e33;box-shadow:0 0 0 3px rgba(238,51,51,.35)}
#aigm-ptt-button.aigm-ptt-live .aigm-ptt-dot{background:#e33;box-shadow:0 0 8px #e33}
#aigm-audio-unlock{position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:10000;padding:10px 18px;font-size:15px;font-weight:600;cursor:pointer;border-radius:8px;border:0;background:#1b5e20;color:#fff;box-shadow:0 4px 16px rgba(0,0,0,.35)}
.aigm-roll-btn{display:block;width:100%;margin-top:8px;padding:10px 16px;font-size:16px;font-weight:700;cursor:pointer;border-radius:8px}
.aigm-rollreq[data-status="done"],.aigm-rollreq[data-status="cancelled"],.aigm-rollreq[data-status="expired"]{opacity:.7}
.aigm-voice-replay{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;margin:0 6px 0 0;padding:0;border-radius:50%;cursor:pointer;font-size:11px;line-height:1;vertical-align:middle}
.aigm-voice-more{margin-left:6px;cursor:pointer;background:none;border:0;text-decoration:underline;color:inherit;font:inherit}
.aigm-panel{padding:8px;display:flex;flex-direction:column;gap:10px}
.aigm-panel-actions{display:flex;flex-wrap:wrap;gap:6px}
.aigm-panel-actions button{flex:1 1 40%;padding:8px;font-weight:600;cursor:pointer}
.aigm-panel h3{margin:8px 0 4px;font-size:13px;text-transform:uppercase;opacity:.8}
.aigm-hp-row,.aigm-roll-row{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:3px 0}
.aigm-hp-bar{height:6px;background:#333;border-radius:3px;overflow:hidden;flex:1}
.aigm-hp-bar>span{display:block;height:100%;background:#2a8}
.aigm-panel-recap{white-space:pre-wrap;max-height:180px;overflow:auto;background:rgba(0,0,0,.25);padding:6px;border-radius:4px}
#aigm-sidebar-btn{cursor:pointer}
details.aigm-advanced{margin:12px 0;padding:8px;border:1px solid rgba(255,255,255,.15);border-radius:6px}
details.aigm-advanced>summary{cursor:pointer;font-weight:600}
[data-aigm-test-status][data-ok="1"]{color:#3c3}
[data-aigm-test-status][data-ok="0"]{color:#e66}
`;
export function injectStyles(doc = globalThis.document) {
  if (!doc || doc.getElementById("aigm-styles")) return false;
  const parent = doc.head || doc.body; if (!parent) return false;
  const s = doc.createElement("style"); s.id = "aigm-styles"; s.textContent = CSS;
  parent.appendChild(s); return true;
}
