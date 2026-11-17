// The files that go into the module zip (what Foundry installs). One list, used by the build and by the tests that check
// every in-game docs link points at a file that is really in the zip.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const root = new URL("..", import.meta.url).pathname;
export const TOP_FILES = ["CHANGELOG.md", "LICENSE", "README.md", "module.json"];
export const DIRS = ["assets", "lang", "scripts"];
export const EXTRA_FILES = ["docs/bot-setup-prompt.md", "docs/SETUP.md", "docs/BOT-API.md", "relay/RUN.md", "examples/echo-gm.mjs"];
function walk(dir) { const out = []; for (const f of readdirSync(join(root, dir)).sort()) { const p = `${dir}/${f}`; if (statSync(join(root, p)).isDirectory()) out.push(...walk(p)); else out.push(p); } return out; }
export function packageFiles() { return [...TOP_FILES, ...DIRS.flatMap(walk), ...EXTRA_FILES]; }
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) console.log(packageFiles().join("\n"));
