// 0.9.8: bot setup prompt teaches faster replies (docs only). Beta.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("0.9.8 the bot setup prompt has the speak-first, short-lines and short-work bullets in Speaking and status, and Core rule 10", () => {
  const p = src("docs/bot-setup-prompt.md");
  const speaking = p.slice(p.indexOf("## Speaking and status"), p.indexOf("## Core rules"));
  assert.match(speaking, /\*\*Speak first, then do the bookkeeping\.\*\*/);
  assert.match(speaking, /\*\*Short spoken lines\.\*\*/);
  assert.match(speaking, /\*\*Keep the work before the reply short\.\*\*/);
  const i = (s) => speaking.indexOf(s);
  assert.ok(i("Post **narration first**") < i("Speak first") && i("Speak first") < i("Short spoken lines") && i("Short spoken lines") < i("Status pill") && i("Status pill") < i("Keep the work"), "bullet order");
  const rules = p.slice(p.indexOf("## Core rules"), p.indexOf("## Events"));
  assert.match(rules, /\n9\. \*\*Several players at once\.\*\*[\s\S]*\n10\. \*\*Reply fast, edit after\.\*\*/);
  assert.doesNotMatch(p, /\n11\. /);
  assert.match(p, /ai-gm-bridge v0\.9\.8\)/); assert.doesNotMatch(p, /v0\.9\.7/);
});

test("0.9.8 the prompt stays generic: no rig, routine-file or personal names, recorded voices only, Ryan default", () => {
  const p = src("docs/bot-setup-prompt.md");
  assert.doesNotMatch(p, /Kev\b|Kevin|live\.js|pb-test|pb-test-live|live-state|Helper\b|Sonia/i);
  assert.match(p, /default Ryan/);
});

test("0.9.8 version, changelog, README, and the GM, wait cooldown note", () => {
  const m = JSON.parse(src("module.json")), p = JSON.parse(src("package.json"));
  assert.equal(m.version, "0.9.8"); assert.equal(p.version, "0.9.8"); assert.equal(m.title, "AI GM Pirate Borg"); assert.equal(m.id, "ai-gm-bridge");
  assert.match(src("CHANGELOG.md"), /^# Changelog\s+## 0\.9\.8/); assert.match(src("README.md"), /v0\.9\.8/);
  assert.match(src("CHANGELOG.md"), /3 second cooldown/);
  assert.match(src("scripts/lib/voiceui.mjs"), /HOLD_COOLDOWN_MS = 3000/);
});
