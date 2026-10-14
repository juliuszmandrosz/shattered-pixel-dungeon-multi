// bot soak test in the harness: N scripted players explore, fight, rest and descend.
// usage: node soak.mjs <seed> <party> <outdir> [minutes] [targetDepth]
import { chromium } from "playwright";
import fs from "node:fs";
const [seed = "4242", party = "WARRIOR,MAGE,ROGUE", out = "soak", minutes = "15", targetDepth = "3"] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const t0 = Date.now(); const now = () => ((Date.now() - t0) / 1000).toFixed(1);
const con = `${out}/console.log`, rep = `${out}/report.log`; fs.writeFileSync(con, ""); fs.writeFileSync(rep, "");
const log = (s) => { const l = `${now()} ${s}`; console.log(l); fs.appendFileSync(rep, l + "\n"); };
const n = party.split(",").length;
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 800 } });
await page.addInitScript(() => {
  const id = new URLSearchParams(location.search).get("player") || "page";
  for (const m of ["log", "info", "warn", "error"]) { const o = console[m].bind(console); console[m] = (...a) => o(`[${id}]`, ...a); }
});
page.on("console", (m) => { const t = m.text(); if (/coop|desync|Exception|rror|stuck/i.test(t)) fs.appendFileSync(con, `${now()} ${t}\n`); });
page.on("pageerror", (e) => fs.appendFileSync(con, `${now()} PAGEERROR ${e.message}\n`));
await page.goto(`http://localhost:3000/test/coop.html?seed=${seed}&party=${party}`);
for (let i = 0; i < 150; i++) { await page.waitForTimeout(2000); if ((await page.evaluate(() => Object.keys(ready).length)) >= n) break; }
log(`frames ready (${n})`);
const frames = () => page.frames().filter((f) => f.url().includes("/game/index.html"));
const state = (f) => f.evaluate(() => (window.spd ? window.spd.state() : null)).catch(() => null);
const order = (f, type, payload = "") => f.evaluate(([t, p]) => window.spd.order(t, p), [type, payload]).catch(() => {});
const neigh = (c, w, len) => { const x = c % w, r = []; for (const dy of [-1, 0, 1]) for (const dx of [-1, 0, 1]) { if (!dx && !dy) continue; const nx = x + dx, nc = c + dy * w + dx; if (nx < 0 || nx >= w || nc < 0 || nc >= len) continue; r.push(nc); } return r; };
const cheb = (a, b, w) => Math.max(Math.abs(a % w - b % w), Math.abs(Math.floor(a / w) - Math.floor(b / w)));
// BFS over known passable cells from pos; returns distance map
function bfs(st, from) {
  const { cells, w } = st, len = cells.length, dist = new Int32Array(len).fill(-1); const q = [from]; dist[from] = 0;
  for (let i = 0; i < q.length; i++) { const c = q[i]; for (const nc of neigh(c, w, len)) { if (dist[nc] >= 0) continue; const ch = cells[nc]; if (ch !== "." && nc !== st.exit) continue; dist[nc] = dist[c] + 1; q.push(nc); } }
  return dist;
}
const bots = Array.from({ length: n }, () => ({ target: -1, since: 0, lastPos: -1, lastMove: Date.now(), bad: new Map(), orders: 0, rests: 0, attacks: 0 }));
let lastApplies = -1, lastProgress = Date.now(), stalls = 0, startDepth = 0, maxDepth = 0, lastSummary = 0, done = false;
const deadline = Date.now() + Number(minutes) * 60000;
while (Date.now() < deadline && !done) {
  const fs_ = frames(); if (fs_.length < n) { await page.waitForTimeout(500); continue; }
  const states = await Promise.all(fs_.map(state));
  if (states.some((s) => !s)) { await page.waitForTimeout(500); continue; }
  for (let i = 0; i < n; i++) {
    const st = states[i], f = fs_[i], bot = bots[i];
    if (st.scene !== "GameScene" || st.windows > 0) { await order(f, "dismiss"); continue; }
    const me = st.heroes[st.me]; if (!me || !me.alive) continue;
    if (!startDepth) startDepth = st.depth;
    maxDepth = Math.max(maxDepth, st.depth);
    if (me.pos !== bot.lastPos) { bot.lastPos = me.pos; bot.lastMove = Date.now(); }
    if (st.strict && st.waiting !== st.me && !me.busy) continue; // someone else's turn
    if (me.busy) { if (Date.now() - bot.lastMove > 8000 && !me.resting) { await order(f, "cancel"); bot.orders++; bot.lastMove = Date.now(); log(`bot${i} stuck while busy at ${me.pos}, cancel`); } else if (me.resting && me.hp >= me.ht) { await order(f, "cancel"); } continue; }
    // enemies in sight: attack the nearest
    if (st.enemies.length) { const e = st.enemies.reduce((a, b) => (cheb(b[0], me.pos, st.w) < cheb(a[0], me.pos, st.w) ? b : a)); await order(f, "cell", String(e[0])); bot.attacks++; bot.orders++; continue; }
    if (me.hp < me.ht * 0.6) { await order(f, "rest", "1"); bot.rests++; bot.orders++; continue; }
    const dist = bfs(st, me.pos);
    // nearest heap, then nearest frontier (known cell next to unknown), then the exit
    let best = -1, bestD = 1e9;
    for (const hp of st.heaps) if (dist[hp] >= 0 && dist[hp] < bestD && !bot.bad.has(hp)) { best = hp; bestD = dist[hp]; }
    if (best < 0) for (let c = 0; c < st.cells.length; c++) {
      if (dist[c] < 0 || dist[c] >= bestD || bot.bad.has(c) || st.cells[c] !== ".") continue;
      if (neigh(c, st.w, st.cells.length).some((nc) => st.cells[nc] === "?")) { best = c; bestD = dist[c]; }
    }
    if (best < 0 && dist[st.exit] >= 0) best = st.exit;
    if (best < 0) { await order(f, "search"); bot.orders++; continue; }
    if (bot.target === best && Date.now() - bot.since > 6000 && me.pos !== best) { bot.bad.set(best, true); log(`bot${i} gives up on ${best}`); bot.target = -1; continue; }
    if (bot.target !== best) { bot.target = best; bot.since = Date.now(); }
    await order(f, "cell", String(best)); bot.orders++;
  }
  // progress / stall / desync monitoring
  const applies = states.map((s) => s.applies), depth = states.map((s) => s.depth);
  if (applies[0] !== lastApplies || states.some((s) => s.scene !== "GameScene")) { lastApplies = applies[0]; lastProgress = Date.now(); }
  const spread = Math.max(...applies) - Math.min(...applies);
  if (Date.now() - lastProgress > 20000) { stalls++; lastProgress = Date.now(); const bar = await page.evaluate(() => document.getElementById("turn").textContent); log(`STALL #${stalls}: applies=${applies} depth=${depth} bar=${bar} heroes=${JSON.stringify(states[0].heroes)} waiting=${states.map((s) => s.waiting + (s.strict ? "s" : ""))}`); await page.screenshot({ path: `${out}/stall-${stalls}.png` }); if (stalls >= 3) { log("too many stalls, stopping"); done = true; } }
  if (states.some((s) => s.desynced)) { log(`DESYNC flagged: ${states.map((s) => s.desynced)} applies=${applies}`); await page.screenshot({ path: `${out}/desync.png` }); done = true; }
  if (Date.now() - lastSummary > 10000) { lastSummary = Date.now(); log(`depth=${depth} applies=${applies} spread=${spread} heroes=${states[0].heroes.map((h) => `${h.pos}:${h.hp}/${h.ht}${h.alive ? "" : "†"}${h.busy ? "b" : ""}`).join(" ")} enemies=${states[0].enemies.length} bots=${bots.map((b) => `${b.orders}/${b.attacks}/${b.rests}`).join(" ")}`); }
  if (maxDepth >= Number(targetDepth) && states.every((s) => s.depth >= Number(targetDepth))) { log(`reached depth ${targetDepth} on every client`); done = true; }
  if (states[0].heroes.every((h) => !h.alive)) { log("party dead"); done = true; }
  await page.waitForTimeout(250);
}
await page.screenshot({ path: `${out}/end.png` });
const bar = await page.evaluate(() => document.getElementById("turn").textContent);
log(`END maxDepth=${maxDepth} stalls=${stalls} bar=${bar}`);
await browser.close();
