// Headless Foundry client for the relay: logs in as the bot GM user (becomes preferred leader),
// forwards `ai-gm-bridge.events` batches into the relay and acks back through the module API.
// Env: FOUNDRY_URL, FOUNDRY_RELAY_USER, FOUNDRY_RELAY_PASSWORD (never logged).
export async function connectFoundry({ url, user, password, onBatch, expectWorld, log = console.log }) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ args: ["--use-gl=swiftshader"] });
  const page = await (await browser.newContext()).newPage();
  page.on("dialog", d => d.dismiss());
  await page.goto(new URL("/join", url).href, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForFunction(() => document.querySelectorAll("select[name=userId] option").length > 1, null, { timeout: 30000 });
  const opts = await page.$$eval("select[name=userId] option", o => o.map(x => [x.value, x.textContent.trim()]));
  const u = opts.find(o => o[1].toLowerCase() === user.toLowerCase()); if (!u) throw new Error("relay user not found");
  await page.selectOption("select[name=userId]", u[0]); await page.fill("input[name=password]", password);
  await Promise.all([page.waitForURL(/\/game/, { timeout: 60000 }), page.click("button[name=join]")]);
  await page.waitForFunction(() => window.game?.ready && game.modules.get("ai-gm-bridge")?.api, null, { timeout: 120000 });
  const world = await page.evaluate(() => game.world.id);
  if (expectWorld && world !== expectWorld) { await browser.close(); throw new Error(`wrong world ${world}, expected ${expectWorld}`); }
  await page.exposeFunction("__aigmRelay", (b) => onBatch(b));
  await page.evaluate(() => Hooks.on("ai-gm-bridge.events", (b) => window.__aigmRelay(JSON.parse(JSON.stringify(b)))));
  log("relay: connected to", world);
  return {
    page, browser,
    run: (cmd) => page.evaluate((c) => game.modules.get("ai-gm-bridge").api.run(c), cmd),
    ack: (ids) => page.evaluate((i) => game.modules.get("ai-gm-bridge").api.ack(i), ids),
    close: async () => { try { await page.evaluate(() => game.logOut?.()); } catch {} await browser.close(); },
  };
}
