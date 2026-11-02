// Point module.json at GitHub releases/latest (module.json + module.zip). Usage: node tools/set-release.mjs https://github.com/OWNER/REPO
import fs from "node:fs";
const base = process.argv[2]?.replace(/\/$/, "");
if (!base || !/^https:\/\//.test(base)) { console.error("usage: node tools/set-release.mjs https://github.com/OWNER/REPO"); process.exit(1); }
const m = JSON.parse(fs.readFileSync("module.json", "utf8"));
m.url = base;
m.manifest = `${base}/releases/latest/download/module.json`;
m.download = `${base}/releases/latest/download/module.zip`;
fs.writeFileSync("module.json", JSON.stringify(m, null, 2) + "\n");
console.log(m.manifest, m.download);
