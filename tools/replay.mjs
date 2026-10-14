// replays a recorded room log in the harness: node replay.mjs <actions.json> <uidA,uidB> <seed> <party> <outdir> [extra query]
// prints the frames' coop console lines (applies, dropped ticks, passes, desyncs) to <outdir>/console.log
import { chromium } from "playwright";
import fs from "node:fs";
const [file, uids, seed, party, out = "replay", extra = ""] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const map = Object.fromEntries(uids.split(",").map((u, i) => [u, "ABCD"[i]]));
const entries = Object.values(JSON.parse(fs.readFileSync(file, "utf8"))).sort((a, b) => a.seq - b.seq)
  .filter((e) => e.type !== "void").map((e) => ({ uid: map[e.uid] || "A", type: e.type, payload: String(e.payload ?? ""), seq: e.seq }));
const t0 = Date.now(); const now = () => ((Date.now() - t0) / 1000).toFixed(1);
const con = `${out}/console.log`; fs.writeFileSync(con, "");
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 800 } });
await page.addInitScript(() => {
  const id = new URLSearchParams(location.search).get("player") || "page";
  for (const m of ["log", "info", "warn", "error"]) { const o = console[m].bind(console); console[m] = (...a) => o(`[${id}]`, ...a); }
});
page.on("console", (m) => { const t = m.text(); if (/coop|desync|Exception|rror/i.test(t)) fs.appendFileSync(con, `${now()} ${t}\n`); });
page.on("pageerror", (e) => fs.appendFileSync(con, `${now()} PAGEERROR ${e.message}\n`));
const url = `http://localhost:3000/test/coop.html?seed=${seed}&party=${party}&policy=off&interval=120${extra ? "&" + extra : ""}`;
await page.goto(url); console.log(now(), "opened", url);
for (let i = 0; i < 120; i++) { await page.waitForTimeout(2000); if ((await page.evaluate(() => Object.keys(ready).length)) >= 2) break; }
console.log(now(), "frames ready");
await page.waitForTimeout(3000);
for (const x of [397, 1197]) { await page.mouse.click(x, 515); await page.waitForTimeout(800); }
await page.waitForTimeout(2000);
await page.screenshot({ path: `${out}/01-start.png` });
console.log(now(), "feeding", entries.length, "entries");
await page.evaluate((list) => window.replay(list), entries);
for (let i = 0; i < 600; i++) { await page.waitForTimeout(2000); if ((await page.evaluate(() => window.replayLeft())) === 0) break; }
await page.waitForTimeout(4000);
console.log(now(), "done, turn bar:", await page.evaluate(() => document.getElementById("turn").textContent));
await page.screenshot({ path: `${out}/02-end.png` });
await browser.close();
