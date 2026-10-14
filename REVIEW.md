# Review focus: co-op movement, combat and turn flow

This branch holds only the source that decides how heroes move and fight in the 4-player
lockstep co-op of this web port (the full fork also has a Next.js lobby and the TeaVM build
artifact, left out here). Players report: taps that do nothing or need repeating, heroes that
stop after one step, a hero that "loses turns", a client that froze mid-fight while the other
kept going (the log showed no entries from it any more). Read `docs/getting-started-web.md`
first: it states the invariants every change relies on.

Where to look:

- `core/.../coop/Coop.java`: the shared action log, `next()` (what a hero does at each act:
  apply an entry, carry on, pass, or park and wait), `dropSkip`, checksums, `receive()` waking
  a parked actor, order gating (`mayOrder`/`allowed`).
- `core/.../actors/hero/Hero.java`: `act()` co-op block, `isBusy()`, `getCloser()` with party
  swapping/waiting, `interrupt()`, `ready()`.
- `core/.../actors/Actor.java`: `process()` (actor thread, timed waits, `simulating` RNG gate,
  `current()`), `simulate(Callback)` for animation callbacks that roll damage.
- `core/.../Dungeon.java`: `focusHero`, party FOV in `observe`, `findPathThroughParty`.
- `lobby/src/app/play/[id]/PlayClient.tsx`: delivery of log entries in seq order, the turn
  policy that writes `skip hero:epoch` entries, AFK and strict-turn timeouts.
- `SPD-classes/.../Random.java`: the simulation/visual RNG split.

Questions we most want answered: can two clients ever take a different decision from the
same log (determinism holes, timing-dependent code on the render thread, lost wake-ups of
the parked actor thread, TeaVM green-thread hazards)? Can a client stall with entries
pending? Can an order be lost or applied twice? Are there cases where a hero cannot act
although it is its turn?
