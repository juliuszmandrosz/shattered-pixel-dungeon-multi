# Co-op test tools

All scripts need the lobby dev server on http://localhost:3000 (`cd lobby && npm run dev`) and
Playwright (`npm i playwright` in this directory, `npx playwright install chromium`).

- `soak.mjs <seed> <party> <outdir> [minutes] [targetDepth]`: scripted players in the harness
  (`lobby/public/test/coop.html`), one per party member. They explore known cells, pick up heaps,
  attack what they see, rest below 60% HP, walk to the stairs and descend. Reports every 10 s,
  flags a checksum desync or a stall (no apply for 20 s) with a screenshot, stops at the target
  depth. Uses `window.spd` (`Coop.debugState` / `Coop.debugOrder`).
- `replay.mjs <actions.json> <uidA,uidB,...> <seed> <party> <outdir> [query]`: replays a room's
  action log (dumped from the database) in the harness with `?policy=off`; the recorded checks
  are compared with the local simulation, so a divergence shows as "desync detected at apply #N"
  and the frames' "applied #N" lines show what differed. `legacyticks=1` for rooms recorded
  before 2026-10-14.
- `session.mjs <url> <dir>`: interactive headless session driven by lines appended to `dir/cmd`
  (click X Y | shot NAME | wait S | eval JS | quit).
- `prod5.mjs <baseUrl> <outdir>`: two anonymous accounts on the real lobby, create/join/start,
  a few taps each, HUD and checksum check.
