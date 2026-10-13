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
client sees its own writes first). The game also posts `{spd:"turn", hero}` whenever a hero
starts waiting for input (the lobby's turn order HUD) and `{spd:"leave"}` when "Main menu" is
pressed inside a room. `Coop` queues the action for the hero that belongs
to `uid` and applies it when that hero's `act()` runs with nothing to do, so all clients apply
it at the same point of the simulation. Selectors opened by the simulation (wand target, item
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
