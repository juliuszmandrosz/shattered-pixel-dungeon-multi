// interactive headless session: node session.mjs "<url>" <dir>
// commands appended to <dir>/cmd (one per line): click X Y | shot NAME | wait S | eval JS | goto URL | quit
// results in <dir>/out.log, game console lines (prefixed by player id) in <dir>/console.log
import { chromium } from "playwright";
import fs from "node:fs";
const [url, dir = "sess"] = process.argv.slice(2);
fs.mkdirSync(dir, { recursive: true });
const cmdFile = `${dir}/cmd`, outFile = `${dir}/out.log`, conFile = `${dir}/console.log`;
fs.writeFileSync(cmdFile, ""); fs.writeFileSync(outFile, ""); fs.writeFileSync(conFile, "");
const t0 = Date.now(); const now = () => ((Date.now() - t0) / 1000).toFixed(1);
const out = (s) => fs.appendFileSync(outFile, `${now()} ${s}\n`);
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 800 } });
await page.addInitScript(() => {
  const id = new URLSearchParams(location.search).get("player") || "page";
  for (const m of ["log", "info", "warn", "error"]) { const o = console[m].bind(console); console[m] = (...a) => o(`[${id}]`, ...a); }
});
page.on("console", (m) => { const t = m.text(); if (/coop|desync|sync|Exception|rror|rngtrace/i.test(t)) fs.appendFileSync(conFile, `${now()} ${t}\n`); });
page.on("pageerror", (e) => fs.appendFileSync(conFile, `${now()} PAGEERROR ${e.message}\n`));
await page.goto(url); out("opened " + url);
let done = 0, shot = 0;
while (true) {
  const lines = fs.readFileSync(cmdFile, "utf8").split("\n").filter(Boolean);
  if (lines.length > done) {
    const line = lines[done++]; const [c, ...rest] = line.split(" ");
    try {
      if (c === "click") { await page.mouse.click(Number(rest[0]), Number(rest[1])); out(`clicked ${rest[0]} ${rest[1]}`); }
      else if (c === "shot") { const f = `${dir}/${String(shot++).padStart(2, "0")}-${rest[0] || "shot"}.png`; await page.screenshot({ path: f }); out(`shot ${f}`); }
      else if (c === "wait") { await page.waitForTimeout(Number(rest[0]) * 1000); out("waited"); }
      else if (c === "eval") { out("eval " + JSON.stringify(await page.evaluate(rest.join(" ")))); }
      else if (c === "goto") { await page.goto(rest[0]); out("opened " + rest[0]); }
      else if (c === "quit") { out("quit"); break; }
      else out("unknown " + line);
    } catch (e) { out("ERR " + e.message); }
  } else await page.waitForTimeout(150);
}
await browser.close();
