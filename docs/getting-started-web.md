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
| `room`, `player`, `order` | reserved for the co-op layer, ignored by the game for now |

A reload of the page resumes the run that has the same seed instead of starting over.
All hero classes are unlocked on the web build regardless of badges.

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
- Saves triggered by closing or reloading the tab can be cut off: the IndexedDB write is asynchronous and the page may unload first. The game detects this on next start ("interrupted while saving") and recovers. A periodic autosave on web is the planned fix.
