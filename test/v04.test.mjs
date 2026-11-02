import test from "node:test"; import assert from "node:assert/strict";
import { planUpload, safeName, UPLOAD_ROOT } from "../scripts/lib/uploads.mjs";
import { buildSpawn, lockBlocks, sightData, lightData } from "../scripts/lib/spawn.mjs";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString("base64");
const MP3 = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0]).toString("base64");

test("planUpload: type, size, magic bytes, safe name, module folder, content-hash name", () => {
  const p = planUpload({ name: "../../etc/Map One!.png", data: PNG });
  assert.equal(p.dir, `${UPLOAD_ROOT}/images`); assert.match(p.fileName, /^[a-z0-9]+-Map-One-?\.png$/); assert.ok(!p.path.includes(".."));
  assert.equal(planUpload({ name: "x.png", data: "data:image/png;base64," + PNG }).path, planUpload({ name: "x.png", data: PNG }).path);
  assert.equal(planUpload({ name: "x.exe", data: PNG }).code, 415);
  assert.equal(planUpload({ name: "x.svg", data: PNG }).code, 415);
  assert.equal(planUpload({ name: "x.jpg", data: PNG }).code, 415); // png bytes named .jpg
  assert.equal(planUpload({ name: "x.png", data: PNG }, { maxBytes: 4, allowed: ["png"] }).code, 413);
  assert.equal(planUpload({ name: "x.mp3", data: PNG }, { maxBytes: 1e6, allowed: ["png"] }).code, 415);
  assert.equal(planUpload({ name: "x.mp3", data: MP3 }).kind, "audio");
  assert.equal(planUpload({ name: "x.mp3", data: MP3, kind: "images" }).code, 400);
  assert.equal(planUpload({ name: "x.png", data: "not base64!!" }).code, 400);
  assert.equal(safeName(""), "file"); assert.equal(safeName(".hidden"), "hidden");
});

test("buildSpawn: clamps, vision/light shape, flags, errors", () => {
  const d = buildSpawn({ x: 100.4, y: 50, name: "Ghost", hidden: true, vision: { range: 5000, angle: 90, visionMode: "darkvision" },
    light: { dim: 10, bright: 20, color: "#ff8800", animation: { type: "torch", speed: 99 } }, locked: true, spawnKey: "k1" });
  assert.deepEqual([d.x, d.y, d.hidden, d.locked], [100, 50, true, true]);
  assert.deepEqual(d.sight, { enabled: true, range: 1000, angle: 90, visionMode: "darkvision" });
  assert.equal(d.light.dim, 20); assert.equal(d.light.animation.speed, 10);
  assert.deepEqual(d.flags["ai-gm-bridge"], { spawnKey: "k1", lock: "move" });
  assert.match(buildSpawn({ x: 0, y: 0, vision: { visionMode: "xray" } }).error, /visionMode/);
  assert.match(buildSpawn({ x: 0, y: 0, light: { color: "red" } }).error, /color/);
  assert.match(buildSpawn({ y: 0 }).error, /x and y/);
  assert.equal(sightData(undefined), undefined); assert.equal(lightData({ enabled: false }).dim, 0);
});

test("lockBlocks: GM never blocked; move scope only blocks movement; all blocks everything", () => {
  assert.equal(lockBlocks("move", { x: 1 }, true), false);
  assert.equal(lockBlocks("move", { x: 1 }, false), true);
  assert.equal(lockBlocks("move", { hidden: true }, false), false);
  assert.equal(lockBlocks("all", { name: "x" }, false), true);
  assert.equal(lockBlocks(null, { x: 1 }, false), false);
});

// Commands against a fake Foundry.
const tokens = []; const files = new Set(); let uploads = 0; let isGM = true;
const mkTok = (d) => { const t = { id: "t" + (tokens.length + 1), ...d, getFlag: (s, k) => t.flags?.[s]?.[k], async update(u) { for (const [k, v] of Object.entries(u)) { if (k.startsWith("flags.")) { const [, s, f] = k.split("."); t.flags ??= {}; t.flags[s] = { ...t.flags[s], [f]: v }; } else t[k] = v; } } }; return t; };
const scene = { id: "s1", tokens: { find: f => tokens.find(f), get: id => tokens.find(t => t.id === id) },
  async createEmbeddedDocuments(_t, arr) { const out = arr.map(d => mkTok(d)); tokens.push(...out); return out; } };
const actor = { id: "a1", name: "Ghost", async getTokenDocument(d) { return { toObject: () => ({ actorId: "a1", name: "Ghost", ...d }) }; } };
globalThis.canvas = { scene };
globalThis.game = { get user() { return { id: "u", isGM }; }, settings: { get: (_m, k) => ({ uploadsEnabled: true, uploadMaxMB: 1, uploadTypes: "" })[k] },
  scenes: { get: () => scene, active: scene }, actors: { get: id => id === "a1" ? actor : null, getName: n => n === "Ghost" ? actor : null } };
globalThis.FilePicker = { async browse(_s, dir) { return { files: [...files].filter(f => f.startsWith(dir)) }; }, async createDirectory() {},
  async upload(_s, dir, file) { uploads++; files.add(`${dir}/${file.name}`); return { status: "success", path: `${dir}/${file.name}` }; } };
const { runCommand } = await import("../scripts/commands.mjs");

test("upload: GM-only, writes once per content, rejects bad type", async () => {
  const r1 = await runCommand({ name: "upload", args: { name: "map.png", data: PNG } }, {});
  assert.equal(r1.ok, true); assert.ok(r1.result.path.startsWith("ai-gm-uploads/images/")); assert.equal(r1.result.existed, false);
  const r2 = await runCommand({ name: "upload", args: { name: "map.png", data: PNG } }, {});
  assert.equal(r2.result.existed, true); assert.equal(uploads, 1);
  assert.equal((await runCommand({ name: "upload", args: { name: "a.html", data: PNG } }, {})).code, 415);
  isGM = false; assert.equal((await runCommand({ name: "upload", args: { name: "map.png", data: PNG } }, {})).code, 403); isGM = true;
});

test("spawnAndVision: places token with vision/light, idempotent by spawnKey; lockToken + setVision", async () => {
  const a = { actorName: "Ghost", x: 200, y: 300, vision: { range: 30 }, light: { dim: 20, bright: 10 }, spawnKey: "ghost-1" };
  const r = await runCommand({ name: "spawnAndVision", args: a }, {});
  assert.equal(r.ok, true, JSON.stringify(r)); assert.deepEqual(r.result.light, { dim: 20, bright: 10 }); assert.equal(r.result.sight, true);
  const again = await runCommand({ name: "spawnAndVision", args: a }, {});
  assert.equal(again.result.duplicate, true); assert.equal(tokens.length, 1);
  assert.equal((await runCommand({ name: "spawnAndVision", args: { actorName: "Nobody", x: 0, y: 0 } }, {})).code, 404);
  const l = await runCommand({ name: "lockToken", args: { tokenId: r.result.tokenId, locked: true, scope: "all" } }, {});
  assert.equal(l.result.scope, "all"); assert.equal(tokens[0].flags["ai-gm-bridge"].lock, "all"); assert.equal(tokens[0].locked, true);
  assert.equal((await runCommand({ name: "lockToken", args: { tokenId: r.result.tokenId, locked: true, scope: "x" } }, {})).code, 400);
  const v = await runCommand({ name: "setVision", args: { tokenId: r.result.tokenId, vision: { enabled: false } } }, {});
  assert.equal(v.ok, true); assert.equal(tokens[0].sight.enabled, false);
});
