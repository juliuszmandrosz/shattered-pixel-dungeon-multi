"use client";

import { use, useEffect, useRef, useState } from "react";
import { get, onChildAdded, onValue, push, ref } from "firebase/database";
import { useAuth } from "@/hooks/useAuth";
import { firebaseDb } from "@/lib/firebase/client";
import type { GameAction, Room, RoomPlayer } from "@/lib/rooms";
import { Button, HeroSprite } from "@/components/pd";

/**
 * Hosts the TeaVM build of the game in an iframe and bridges it to the room's
 * action stream in Realtime Database:
 *   game -> page   postMessage({ spd: "action", type, payload })  -> push to actions/{room}
 *   page -> game   actions/{room} child_added -> postMessage({ spd: "action", ... }) into the iframe
 * Every client replays the whole stream from the start (rooms always begin a fresh run), so a
 * reload is also the resync path: "Resync" reloads the iframe and replays the log.
 */
export function PlayClient({ params }: { params: Promise<{ id: string }> }) {
  const { id: roomId } = use(params);
  const { user } = useAuth();
  const frame = useRef<HTMLIFrameElement>(null);
  const [room, setRoom] = useState<Room | null>(null);
  // read once: the party is fixed at the moment the run starts and must not change mid-run
  const [players, setPlayers] = useState<Record<string, RoomPlayer> | null>(null);
  // the game signals {spd:"ready"} once its message listener is installed; actions delivered
  // before that would be lost, so the database subscription waits for it
  const [gameReady, setGameReady] = useState(false);
  // bumping this reloads the iframe, which replays the action log from the start
  const [generation, setGeneration] = useState(0);
  // delivery index in database order, identical on every client (used as the action's seq)
  const delivered = useRef(0);

  useEffect(() => {
    if (!user) return;
    const db = firebaseDb();
    const offRoom = onValue(ref(db, `rooms/${roomId}`), (s) => setRoom((s.val() as Room) ?? null));
    get(ref(db, `roomPlayers/${roomId}`)).then((s) => setPlayers((s.val() as Record<string, RoomPlayer>) ?? {}));
    return offRoom;
  }, [roomId, user]);

  // actions from the database into the game, in database order, once the game listens
  useEffect(() => {
    if (!user || !gameReady) return;
    delivered.current = 0;
    return onChildAdded(ref(firebaseDb(), `actions/${roomId}`), (s) => {
      const action = s.val() as GameAction;
      const seq = delivered.current++;
      frame.current?.contentWindow?.postMessage({ spd: "action", id: s.key, ...action, seq }, window.location.origin);
    });
  }, [roomId, user, gameReady]);

  // messages from the game: "ready" once per load, then actions to append to the database
  useEffect(() => {
    if (!user) return;
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data) return;
      if (data.spd === "ready") {
        setGameReady(true);
        return;
      }
      if (data.spd !== "action") return;
      const action: GameAction = { uid: user!.uid, seq: -1, type: String(data.type), payload: data.payload ?? null, at: Date.now() };
      push(ref(firebaseDb(), `actions/${roomId}`), action);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [roomId, user]);

  function resync() {
    setGameReady(false);
    setGeneration((g) => g + 1);
  }

  if (!room || !user || !players) {
    return (
      <main className="pd-muted p-10">
        Descending<span className="pd-blink">...</span>
      </main>
    );
  }

  const order = Object.entries(players)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([uid]) => uid);
  const query = new URLSearchParams({
    room: roomId,
    player: user.uid,
    seed: String(room.seed ?? ""),
    order: order.join(","),
    heroClass: players[user.uid]?.heroClass ?? "WARRIOR",
    // every member's class in player order; the game creates the whole party
    party: order.map((uid) => players[uid]?.heroClass ?? "WARRIOR").join(","),
    v: String(generation),
  });

  return (
    <main className="flex h-screen flex-col bg-black">
      <div className="flex items-center justify-between gap-4 bg-[#1c1b23] px-3 py-1 text-sm">
        <span className="pd-title">{room.name}</span>
        <div className="flex items-center gap-3">
          {order.map((uid) => (
            <span key={uid} className="flex items-center gap-1">
              <HeroSprite heroClass={players[uid]?.heroClass ?? "WARRIOR"} className="!h-[15px] !w-[12px]" />
              <span className={uid === user.uid ? "pd-positive" : ""}>{players[uid]?.name}</span>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span className="pd-muted">seed {room.seed}</span>
          <Button onClick={resync} title="Reload the game and replay the room's actions">
            Resync
          </Button>
        </div>
      </div>
      <iframe
        key={generation}
        ref={frame}
        title="Shattered Pixel Dungeon"
        src={`/game/index.html?${query.toString()}`}
        className="h-full w-full flex-1 border-0"
        allow="autoplay; fullscreen; gamepad"
      />
    </main>
  );
}
