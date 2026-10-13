"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { get, onChildAdded, onValue, ref, runTransaction, set } from "firebase/database";
import { useAuth } from "@/hooks/useAuth";
import { firebaseDb } from "@/lib/firebase/client";
import { actionKey, type GameAction, type Room, type RoomPlayer } from "@/lib/rooms";
import { Button, HERO_LABEL, HeroSprite } from "@/components/pd";

/**
 * Hosts the TeaVM build of the game in an iframe and bridges it to the room's
 * action stream in Realtime Database:
 *   game -> page   postMessage({ spd: "action", type, payload })  -> seq from a transaction on
 *                  rooms/{room}/nextSeq, then actions/{room}/{seq}
 *   page -> game   actions/{room} child_added, delivered strictly in seq order (gaps are buffered)
 *                  -> postMessage({ spd: "action", uid, seq, type, payload }) into the iframe
 * The server-assigned seq is what keeps every client's numbering identical; delivery order of
 * child_added differs between clients (own writes show up first), so it cannot be used.
 * The game also posts { spd: "turn", hero } for the turn HUD and { spd: "leave" } for "Main menu".
 * Every client replays the whole stream from the start (rooms always begin a fresh run), so a
 * reload is also the resync path: "Resync" reloads the iframe and replays the log.
 */
export function PlayClient({ params }: { params: Promise<{ id: string }> }) {
  const { id: roomId } = use(params);
  const { user } = useAuth();
  const router = useRouter();
  const frame = useRef<HTMLIFrameElement>(null);
  const [room, setRoom] = useState<Room | null>(null);
  // read once: the party is fixed at the moment the run starts and must not change mid-run
  const [players, setPlayers] = useState<Record<string, RoomPlayer> | null>(null);
  // the game signals {spd:"ready"} once its message listener is installed; actions delivered
  // before that would be lost, so the database subscription waits for it
  const [gameReady, setGameReady] = useState(false);
  // bumping this reloads the iframe, which replays the action log from the start
  const [generation, setGeneration] = useState(0);
  // index (in player order) of the hero waiting for input, from the game
  const [turnHero, setTurnHero] = useState<number | null>(null);

  useEffect(() => {
    if (!user) return;
    const db = firebaseDb();
    const offRoom = onValue(ref(db, `rooms/${roomId}`), (s) => setRoom((s.val() as Room) ?? null));
    get(ref(db, `roomPlayers/${roomId}`)).then((s) => setPlayers((s.val() as Record<string, RoomPlayer>) ?? {}));
    return offRoom;
  }, [roomId, user]);

  // actions from the database into the game, strictly in seq order, once the game listens
  useEffect(() => {
    if (!user || !gameReady) return;
    const pending = new Map<number, GameAction>();
    let next = 1;
    return onChildAdded(ref(firebaseDb(), `actions/${roomId}`), (s) => {
      const action = s.val() as GameAction;
      if (typeof action.seq !== "number" || action.seq < next) return;
      pending.set(action.seq, action);
      while (pending.has(next)) {
        const a = pending.get(next)!;
        pending.delete(next);
        frame.current?.contentWindow?.postMessage({ spd: "action", ...a }, window.location.origin);
        next++;
      }
    });
  }, [roomId, user, gameReady]);

  const sendAction = useCallback(
    async (type: string, payload: unknown) => {
      const db = firebaseDb();
      const result = await runTransaction(ref(db, `rooms/${roomId}/nextSeq`), (n: number | null) => (n ?? 0) + 1);
      const seq = result.snapshot.val() as number;
      const action: GameAction = { uid: user!.uid, seq, type, payload: payload ?? null, at: Date.now() };
      await set(ref(db, `actions/${roomId}/${actionKey(seq)}`), action);
    },
    [roomId, user],
  );

  // messages from the game: "ready" once per load, turn changes, leave, and actions to append
  useEffect(() => {
    if (!user) return;
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data) return;
      switch (data.spd) {
        case "ready":
          setGameReady(true);
          return;
        case "turn":
          setTurnHero(typeof data.hero === "number" ? data.hero : null);
          return;
        case "leave":
          router.push("/");
          return;
        case "action":
          // actions sent by the game carry no uid; relayed ones do and must not be re-sent
          if (data.uid === undefined) void sendAction(String(data.type), data.payload);
          return;
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [user, router, sendAction]);

  function resync() {
    setGameReady(false);
    setTurnHero(null);
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
          <span className="pd-muted">seed {room.seed}</span>
          <Button onClick={resync} title="Reload the game and replay the room's actions">
            Resync
          </Button>
        </div>
      </div>
      <div className="relative flex-1">
        <iframe
          key={generation}
          ref={frame}
          title="Shattered Pixel Dungeon"
          src={`/game/index.html?${query.toString()}`}
          className="h-full w-full border-0"
          allow="autoplay; fullscreen; gamepad"
        />
        <TurnOrder order={order} players={players} turnHero={turnHero} me={user.uid} />
      </div>
    </main>
  );
}

const ROW = 44;

/**
 * Turn order HUD on the left (below the game's own status pane): the hero waiting for input is
 * on top, the others follow in the order they will act. When a turn passes, the previous hero
 * slides to the bottom.
 */
function TurnOrder({
  order,
  players,
  turnHero,
  me,
}: {
  order: string[];
  players: Record<string, RoomPlayer>;
  turnHero: number | null;
  me: string;
}) {
  const start = turnHero ?? 0;
  const position = new Map<string, number>();
  order.forEach((uid, i) => position.set(uid, (i - start + order.length) % order.length));
  const myTurn = turnHero !== null && order[turnHero] === me;
  return (
    <div className="pointer-events-none absolute left-3 select-none" style={{ top: "28%", height: order.length * ROW, width: 172 }}>
      {order.map((uid) => {
        const p = players[uid];
        const pos = position.get(uid) ?? 0;
        const active = turnHero !== null && pos === 0;
        return (
          <div
            key={uid}
            className={`pd-window absolute left-0 flex items-center gap-2 px-2 py-1 transition-all duration-500 ease-in-out ${
              active ? "opacity-100" : "opacity-70"
            }`}
            style={{ top: pos * ROW, transform: active ? "translateX(6px) scale(1.04)" : "none", width: 160 }}
          >
            <HeroSprite heroClass={p?.heroClass ?? "WARRIOR"} className="!h-[15px] !w-[12px]" />
            <div className="min-w-0 flex-1 leading-tight">
              <div className={`truncate text-xs ${uid === me ? "pd-positive" : ""}`}>{p?.name ?? "?"}</div>
              <div className="pd-muted text-[10px]">{HERO_LABEL[p?.heroClass ?? "WARRIOR"]}</div>
            </div>
            {active && <span className={`text-[10px] ${myTurn ? "pd-positive pd-blink" : "pd-title"}`}>{myTurn ? "YOU" : "..."}</span>}
          </div>
        );
      })}
    </div>
  );
}
