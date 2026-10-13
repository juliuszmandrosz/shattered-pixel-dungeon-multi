# Shattered Pixel Dungeon Multi

A browser build of [Shattered Pixel Dungeon](https://github.com/00-Evan/shattered-pixel-dungeon) with up to four-player turn-based co-op.

**Play:** https://shattered-pixel-dungeon-multi.vercel.app

Pick a nickname, found a party (optionally with a password) or join one, choose a hero class in the waiting room, and the host starts the descent. Every player controls their own hero; turns pass the way they do for mobs, so one player's slow move does not block the others for long.

## How co-op works

Every client runs the full game simulation. Only player actions travel over the network, through a Firebase Realtime Database list per room:

- the dungeon seed is shared, and the simulation uses a seeded random generator that render-side code (particles, UI) never touches
- a tap on the map, a rest, a search, an item use, a wand target or an item pick is appended to the room's action log and applied by every client at the same point of the simulation
- after each applied action the clients exchange a state checksum; a mismatch shows "Out of sync", and **Resync** in the game header reloads the game and replays the action log from the start, which is also how a late joiner catches up

Details and the list of engine changes are in [`docs/getting-started-web.md`](docs/getting-started-web.md).

## Repository layout

```
core/, SPD-classes/   the game, forked from upstream 4.0.2 with the co-op and web changes
core/.../coop/        lockstep action queue, checksums, selector proxies
web/                  TeaVM (gdx-teavm) build of the game for the browser
lobby/                Next.js lobby on Vercel: rooms, passwords, waiting room, action relay
lobby/public/game/    the built game, served by the lobby
lobby/public/test/    coop.html, a local harness that runs one game instance per player
docs/                 build guides (web, and the upstream Android, desktop and iOS guides)
```

## Running it yourself

Game build (needs JDK 17, about 12 GB of RAM for TeaVM):

```
./gradlew :web:gdx_teavm_web_js_build
cp web/build/dist/js/webapp/app.js lobby/public/game/app.js
```

Lobby (needs a Firebase project with anonymous Auth and a Realtime Database, see [`lobby/README.md`](lobby/README.md) and `lobby/.env.example`):

```
cd lobby
npm install
npm run dev
```

The co-op engine can be tried without Firebase: serve `lobby/public` statically and open
`/test/coop.html?seed=9004&party=WARRIOR,MAGE,ROGUE` to get one game frame per party member with an in-page relay.

## Credits and license

This is a fork of [Shattered Pixel Dungeon](https://shatteredpixel.com/shatteredpd/) by [00-Evan](https://github.com/00-Evan), itself based on [Pixel Dungeon](https://github.com/00-Evan/pixel-dungeon-gradle) by [Watabou](https://watabou.itch.io/). All game content, art, music and design are theirs; if you enjoy the game, consider [supporting Evan on Patreon](https://www.patreon.com/ShatteredPixel) and playing the [official releases](https://github.com/00-Evan/shattered-pixel-dungeon/releases). The web build uses [gdx-teavm](https://github.com/xpenatan/gdx-teavm).

Licensed under the GNU GPLv3, see [`LICENSE.txt`](LICENSE.txt). The source of the version running at the link above is this repository.
