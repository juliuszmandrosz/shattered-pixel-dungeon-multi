# lobby

Next.js app that hosts the browser build of the game and the co-op lobby (rooms, passwords,
waiting room, game page). Backend is Firebase: anonymous Auth and Realtime Database.

## Layout

```
public/game/           the TeaVM build of the game, copied from ../web/build/dist/js/webapp
src/app/page.tsx       landing: nickname, open rooms, create room
src/app/rooms/[id]     waiting room: players, presence, class pick, ready, host starts
src/app/play/[id]      the game in an iframe + bridge between postMessage and actions/{room}
src/app/api/rooms      route handlers (Admin SDK): create, join with password check, start
src/lib/rooms.ts       database layout and types
database.rules.json    Realtime Database security rules
```

## Local setup

1. `cp .env.example .env.local` and fill in the Firebase web config (Firebase console > Project
   settings > Your apps > lobby). These values are public by design.
2. Service account for the route handlers: Project settings > Service accounts > Generate new
   private key, then `base64 -i key.json | tr -d '\n'` into `FIREBASE_SERVICE_ACCOUNT_B64`. Never commit it.
3. `npm install && npm run dev`

## Deploying the database rules

```bash
firebase login            # once
firebase deploy --only database
```

## Updating the game build

The game is built on a developer machine (TeaVM needs ~12 GB of heap, see
`../docs/getting-started-web.md`) and committed here:

```bash
(cd .. && ./gradlew :web:gdx_teavm_web_js_build)
rm -rf public/game && mkdir -p public/game
cp -R ../web/build/dist/js/webapp/. public/game/ && rm -rf public/game/WEB-INF
```

## Vercel

Project root directory: `lobby`. Environment variables: everything from `.env.example`.
After the first deploy add the Vercel domain to Firebase console > Authentication > Settings >
Authorized domains, otherwise anonymous sign-in is rejected from the deployed site.

## Game <-> page protocol

The page owns the Firebase connection; the game only talks to its parent window:

- game -> page: `postMessage({ spd: "action", type, payload })`
- page -> game: `postMessage({ spd: "action", id, uid, seq, type, payload, at })` for every
  child of `actions/{roomId}`, in push-id order (also replayed on reconnect)

Room id, player id, seed, player order and hero class are passed in the iframe query string.
The game does not act on any of this yet; co-op support in the engine is in progress
(see `../docs` once the architecture document lands).
