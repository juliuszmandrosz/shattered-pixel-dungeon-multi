# Compiling for the Web (TeaVM)

The `web` module compiles the game to JavaScript with [TeaVM](https://teavm.org/) through the
[gdx-teavm](https://github.com/xpenatan/gdx-teavm) libGDX backend. The result is a static
directory (HTML, JS, assets) that any web server or static host can serve.

## Requirements

- JDK 17 or newer (the gdx-teavm artifacts are built for JVM 17+; the rest of the project still targets Java 11).
- About 12 GB of free RAM for the TeaVM compiler. The game is ~230k lines of Java and TeaVM
  keeps the whole reachable program in memory. `web/build.gradle` runs the compiler in its own
  process with a 12 GB heap (`processMemory`), lower it on smaller machines at the cost of a longer build.
- A WebGL-capable browser.

## Building

```bash
./gradlew :web:gdx_teavm_web_js_build
```

Output lands in `web/build/dist/js/webapp`:

```
index.html   entry page, calls main([version, versionCode])
app.js       the compiled game (~11 MB minified, ~38 MB with obfuscated=false; serve it brotli'd)
assets/      game assets copied from core/ and desktop/
scripts/     freetype.js (font rendering), howler.js (audio), gdx.wasm.js
```

The first build takes several minutes, incremental builds about two.

## Running locally

```bash
./gradlew :web:gdx_teavm_web_js_run     # builds and serves on http://localhost:8080
```

or serve the output directory with any static server:

```bash
cd web/build/dist/js/webapp && python3 -m http.server 8090
```

## Launching straight into a run (lobby integration)

`WebShatteredPixelDungeon` reads the query string of the page (`WebParams`). With a `seed`
present it skips the welcome, title and hero selection screens:

| Parameter | Meaning |
| --- | --- |
| `seed` | dungeon seed as a number (0 .. 26^9-1), applied through the custom seed setting |
| `heroClass` | `WARRIOR`, `MAGE`, `ROGUE`, `HUNTRESS`, `DUELIST` or `CLERIC` |
| `party` | every party member's class in player order, e.g. `WARRIOR,MAGE` |
| `rngtrace` | debug: log the JS stack of every simulation RNG draw made by the actor thread (`rngtrace <player>` in the console). Only readable with `obfuscated=false` in `web/build.gradle`. |
| `room`, `player`, `order` | co-op: room id, this player's id, all player ids in order (comma separated). With all three present the game runs in lockstep co-op; the hero at index i of `party` belongs to the player at index i of `order`. Without them the party is played hot-seat from one client. |

A reload of the page resumes the run that has the same seed instead of starting over.
All hero classes are unlocked on the web build regardless of badges.

## Co-op in one paragraph

Every client runs the full simulation (deterministic: seeded RNG with a separate generator for
visuals, ordered actor and mob collections, id tie-breaks). Only player actions travel: a tap on
the map, a rest, a search, an item use, a target pick or an item pick is posted to the hosting
page as `{spd:"action", type, payload}`, the page relays it (Realtime Database in the lobby, an
in-page relay in `lobby/public/test/coop.html`) and every client receives
`{spd:"action", uid, seq, type, payload}`. `seq` must come from one place for everyone: the lobby
takes it from a transaction on `rooms/{room}/nextSeq` and delivers actions strictly in `seq`
order (the order in which Realtime Database raises `child_added` differs between clients, a
client sees its own writes first). The game also posts `{spd:"turn", ...}` whenever it looks
at the log for a hero (the lobby's turn HUD and skip policy) and `{spd:"leave"}` when "Main
menu" is pressed inside a room. `Coop` appends the entry to its log and the hero it belongs
to consumes it in `act()`, so all clients apply it at the same point of the simulation. Selectors opened by the simulation (wand target, item
to read a scroll on) are parked, the owner answers them through the queue and every client
resolves the parked selector with the same answer. Each applied action logs a state checksum
(`coop: applied seq=… checksum=… now=… rng=…`) and sends it as a `check` message; a client whose
checksum differs prints "Out of sync" and should reload, which replays the room's action log
from the start (rooms always begin a fresh run, so a reload is also how a late joiner catches
up). The HUD, toolbar and inventory follow `Dungeon.localHero()`.

The RNG gate matters: `Random` uses the simulation generator only while the actor thread runs
(`Actor.simulating`) or a level is being generated (`InterlevelScene.simulating`). Particles
and other render-side callers get a separate generator. The gate cannot use thread identity
because on the web `Thread.currentThread()` is not stable across green-thread switches, so
`Actor.process` clears the flag around the two points where it blocks, and the level
generation thread clears its flag before the story screen and fade are rendered (their length
depends on the player). `Dungeon.hero` is set by `Actor.process` to the acting hero, or to a
deterministic hero for mobs, blobs and buffs, and only goes back to the local hero while the
actor thread is paused.

Co-op rooms never save: `Dungeon.saveAll()` is a no-op there. Saving calls `Actor.fixTime()`,
which rebases every actor's time on that client only, and the web backend saves whenever a tab
is hidden (pause), so a player switching tabs would desync `now` for everyone else.

**The log invariant.** A simulation decision may consult the log only at a point where it
waits for the log. `Coop.next(hero)` is the single place a hero looks: entries sit in one
log in seq order with a cursor on the first unconsumed one. A hero with something to do (a
walk, resting) needs the entry at the cursor before every step: its own entry redirects or
confirms it (a `skip` is "nothing new", the page writes them, see below), a foreign one lets it
carry on, no entry parks it. An idle hero while nobody sees an enemy takes its own entry at the
cursor, or lets a turn pass (`Hero.pass`) when the cursor holds somebody else's entry, so
players explore without waiting for each other, like in single player. An idle hero while an
enemy is in sight (`Hero.seesEnemy` of any living hero, simulation state) waits for its own
next entry wherever it is in the log: a strict turn, and during it the other players' taps are
refused with feedback (`Coop.mayOrder`). Whether an entry arrived before or after a step
never matters, every branch reads the log at a position it would wait for. Orders are never
coalesced or reordered on receipt.

**Who writes the skips.** The game posts `{spd:"turn", hero, epoch, danger, waiting, states}`
whenever it looks at the log for a hero (and right after a step, so the next entry is on its
way during the animation). The page writes `skip hero:epoch` ("carry on") at once for its own
hero when it is busy, and once more after `RETRY_MS` if the game is still parked on it (a lost
write); the other clients write it after `AFK_MS` (staggered by player order) in case the
owner's tab is gone; a strict turn is skipped only after `SKIP_SECONDS_DANGER` or by the
countdown button. An idle hero needs no entry of its own: with no enemy in sight it lets the
turn pass on the busy hero's entry. `epoch` is the number of entries applied (and passes) for
that hero, identical everywhere, so duplicates and late skips are dropped the same way on
every client. A skip written by the hero's own client is also dropped once the hero is idle
(`Coop.dropSkip`): it was written ahead for a walk that has ended since, and applied it would
let the turn pass, usually right in front of the enemy whose appearance interrupted the walk
(the "my hero gets fewer moves" report of 2026-10-14: both heroes lost a turn every time an
enemy came into view mid-walk, and the idle one lost its first combat turn to the skip its page
had written while the other walked). Checksums travel every fourth apply, keyed by the apply
count.

**The level must not depend on the player's profile.** Upstream reads the local journal and
the tutorial flag while generating: the guidebook on floor 1 and the searching page on floor 2
(`EntranceRoom`), guide and lore pages (`RegularLevel.createItems`), hidden entrance doors
(`RegularPainter`), and `SPDSettings.intro()` also switches hunger off and stops accidental
door discovery. Two players with different journals got different heaps and maps (seen when
replaying a recorded room in the harness: one heap short from the first checksum on). In co-op
none of the pages drop, and `SPDSettings.intro()` is false.

**Party members never block.** Corridors are one tile wide, so a hero standing in a doorway
would make every order of the hero behind it a silent no-op (`getCloser` found no path, no
time passed; this was the "I click and nothing happens" report). `Dungeon.findPassable` lets a
hero's path run through other heroes when the way round is more than two steps longer (or
there is none), `Hero.getCloser` swaps places with a hero standing on the next step or coming
the other way, exactly like the ally swap in `Char.interact`, and waits a turn behind one
walking the same way. A party member on the path never cancels the walk (upstream drops a
path that doubled in length). Tapping a party member walks there; it does not follow them
(`HeroAction.Interact` on a hero made the tapper trail the other player whenever the target
cell happened to be occupied when the order was applied).

**Animation callbacks are simulation.** Melee damage is rolled when the attack animation
finishes (`CharSprite.onComplete` -> `Char.onAttackComplete`), on the render thread while the
actor thread is parked, so the gate would hand those draws to the visual generator and every
client would roll its own damage. `Actor.simulate(Callback)` sets `Actor.simulating` around
every such callback: attack/operate/motion/jump completions, missiles landing (`MissileSprite`,
`MagicMissile`, `Lightning`, `Chains`) and knockback (`Pushing`).

**UI code on the actor thread must not draw.** `AttackIndicator.updateState` runs from
`Hero.ready()` and picked a random target from a per-client list; it takes the first now.
The camera follows the local hero only (`HeroSprite.followed`): a camera chasing every hero
that moves scrolls the map under the player's cursor.

**Lobby transport safety.** `sendAction` retries with a fresh seq when a write is refused; a
client waiting on a missing seq for `GAP_SECONDS` writes a `void` entry there (first writer
wins), which is never delivered to the game.

Every UI path that gives the hero an order goes through `Coop` (`handleCell`, `useItem`,
`selectItem`, `resume`, `waitOrPickup`, rest and search): tap on the map, attack button, loot
button, resume button, toolbar wait/pick-up, keyboard moves. Calling `hero.handle()` or
mutating `curAction`/`resting` from the UI directly desyncs the clients (the attack button did
exactly that: a snake died on one client and lived on the other). A tap while the local hero
walks a path is queued too and replaces the walk, like a tap does in single player.

Not yet in co-op: talents, `WndOptions` prompts opened inside the simulation, non-owner
clients may still see item windows, death handling beyond "the run continues while someone
is alive".

## Where saves live

Game files (`game1/game.dat`, rankings, badges, journal) go to the browser's IndexedDB,
database `db/assets`. Preferences go to `localStorage` under the `pref:shattered-pixel-dungeon:` prefix.
Clearing site data in the browser wipes the run.

## What the web build changes in the engine

Every change is guarded by `DeviceCompat.isWeb()`, so native builds behave exactly as before.

| Where | Why |
| --- | --- |
| `DeviceCompat` | Platform detection now uses `Gdx.app.getType()` instead of `SharedLibraryLoader`, which does not exist on the web backend. Adds `isWeb()`. |
| `NoosaScript` | WebGL has no client-side vertex arrays. The `FloatBuffer` draw methods stream their data through a shared GL buffer on web. Used by text rendering, `Flare` and `CircleArc`. |
| `FileUtils` | TeaVM's GZIP output stream fails on `flush()`, so web saves are written uncompressed. `Bundle.read` detects the format from the header, so saves stay compatible both ways. |
| `RenderedText` | The "text measured from the actor thread" sanity check is skipped: TeaVM's green threads report the wrong current thread when JS calls back into Java. |
| `GameScene` | `destroy()` and `onPause()` never block on the actor thread. All TeaVM threads share one JS thread, so blocking there is impossible, and unnecessary because the actor thread cannot run concurrently. |
| `WebPlatformSupport` | Asian-script detection and text splitting use explicit code point ranges because TeaVM's regex engine does not support `\p{InXxx}` Unicode block names. |

## Build flags that matter

- `obfuscated = true` (production): 38 MB -> 11 MB. Safe for the save system because every game class
  is registered through `reflection('com.shatteredpixel.shatteredpixeldungeon**')` and `com.watabou**`,
  so `Class.forName` lookups in `Bundle` keep working. Verified: new game, save, main menu, continue.
- `fastGlobalAnalysis = true` must stay on. With it off (TeaVM's full interprocedural analysis) the
  build succeeds but the game shows a black screen with no console errors (TeaVM 0.15 / gdx-teavm 1.6.2).
- `optimization = BALANCED`. `ADVANCED` breaks AssetManager in gdx-teavm 1.6.x (upstream issue #182).

## Known limitations

- No fullscreen toggle and no vibration.
- `app.js` is large. Put it behind a CDN with compression, or enable `obfuscated`/`BALANCED` optimisation in `web/build.gradle` for a smaller file.
- Tested so far: welcome, hero selection, level generation, movement, combat, save and reload, pause on tab switch.
- Saves triggered by closing or reloading the tab can be cut off: the IndexedDB write is asynchronous and the page may unload first. The game detects this on next start ("interrupted while saving") and recovers. Outside co-op rooms the web build therefore autosaves every 5 seconds of play (`WebShatteredPixelDungeon.render`). Co-op rooms never save: they replay the action log instead.
