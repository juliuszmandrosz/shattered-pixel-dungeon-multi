// two anonymous players on the real lobby: create, join, ready, start, then inspect the turn HUD
// usage: node prod2.mjs <baseUrl> <outdir>
import { chromium } from "playwright";
import fs from "node:fs";
const [base = "https://shattered-pixel-dungeon-multi.vercel.app", out = "prod2"] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const ctxA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const A = await ctxA.newPage(), B = await ctxB.newPage();
for (const [n, p] of [["A", A], ["B", B]]) {
  p.on("console", (m) => { const t = m.text(); if (/applied #/.test(t)) applied[n]++; if (/coop|desync|rror|FIREBASE|permission|denied/i.test(t)) console.log(n, t.replace(/ mobs=.*$/, "").slice(0, 300)); });
  p.on("pageerror", (e) => console.log(n, "PAGEERROR", e.message));
}
const shot = async (p, n) => p.screenshot({ path: `${out}/${n}.png` });
const hudText = async (p) => p.evaluate(() => Array.from(document.querySelectorAll('div[style*="28%"] > div')).map((e) => e.textContent.trim().replace(/\s+/g, " ")));
const hasTurn = (rows) => /EXPLORING|COMBAT/.test(rows.join("|"));
const applied = { A: 0, B: 0 };
const name = "autotest-" + Date.now().toString(36);
await A.goto(base + "/");
await A.getByPlaceholder("Party name").fill(name);
await A.getByRole("button", { name: /enter the dungeon/i }).first().click();
await A.waitForURL(/\/rooms\//, { timeout: 30000 });
const roomId = A.url().split("/rooms/")[1];
console.log("room", roomId, name);
await B.goto(base + "/");
await B.getByText(name).first().waitFor({ timeout: 30000 });
const row = B.getByText(name).first().locator("xpath=ancestor::*[.//button][1]");
await row.getByRole("button", { name: /join/i }).click();
await B.waitForURL(/\/rooms\//, { timeout: 30000 });
await B.getByRole("button", { name: /^ready$/i }).click();
await A.getByRole("button", { name: /^ready$/i }).click();
await A.waitForTimeout(1000);
await A.getByRole("button", { name: /^descend$/i }).first().click();
await A.waitForURL(/\/play\//, { timeout: 30000 });
await B.waitForURL(/\/play\//, { timeout: 30000 });
console.log("both in play");
await A.waitForTimeout(12000);
await shot(A, "02-play-A"); await shot(B, "02-play-B");
// story screen "Continue" (centre, 66%) and the badge popup a fresh account gets (centre):
// click until the HUD reports a turn, at most 10 rounds
for (let i = 0; i < 10; i++) {
  const ta = await hudText(A), tb = await hudText(B);
  if (hasTurn(ta) && hasTurn(tb)) break;
  for (const [p, t] of [[A, ta], [B, tb]]) {
    if (hasTurn(t)) continue;
    const box = await p.locator("iframe").boundingBox();
    await p.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.66);
    await p.waitForTimeout(700);
    await p.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.45);
  }
  await A.waitForTimeout(2500);
}
await A.waitForTimeout(2000);
console.log("HUD A", JSON.stringify(await hudText(A)));
console.log("HUD B", JSON.stringify(await hudText(B)));
await shot(A, "03-ingame-A"); await shot(B, "03-ingame-B");
// layout is random: tap three cells away in each direction; floor cells start a walk, walls do nothing
const offsets = [[0, 102], [102, 0], [0, -102], [-102, 0]];
for (const [dx, dy] of offsets) { await A.mouse.click(640 + dx, 385 + dy); await A.waitForTimeout(3500); }
console.log("after A taps: HUD A", JSON.stringify(await hudText(A)), "HUD B", JSON.stringify(await hudText(B)), "applied", JSON.stringify(applied));
await shot(A, "04-afterA-A"); await shot(B, "04-afterA-B");
for (const [dx, dy] of offsets) { await B.mouse.click(640 + dx, 385 + dy); await B.waitForTimeout(3500); }
console.log("after B taps: HUD A", JSON.stringify(await hudText(A)), "HUD B", JSON.stringify(await hudText(B)), "applied", JSON.stringify(applied));
await shot(A, "05-afterB-A"); await shot(B, "05-afterB-B");
const before = { ...applied };
await A.waitForTimeout(8000);
console.log("after 8 s idle: applied", JSON.stringify(applied), "before", JSON.stringify(before));
await shot(A, "06-wait-A"); await shot(B, "06-wait-B");
console.log("room", roomId);
await browser.close();
