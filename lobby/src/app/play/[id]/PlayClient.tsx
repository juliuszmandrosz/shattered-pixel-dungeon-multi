"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  // the hero waiting for input, from the game: index in player order, its order count (epoch,
  // identical on every client) and whether the party sees an enemy
  const [turn, setTurn] = useState<{ hero: number; epoch: number; danger: boolean } | null>(null);
  // seconds the waited-for player has had this turn (drives the skip timer and countdown)
  const [waited, setWaited] = useState(0);

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
    let gapTimer: ReturnType<typeof setTimeout> | null = null;
    const db = firebaseDb();
    // a seq is reserved by a transaction and written afterwards; a client that dies in between
    // would leave a gap that stalls everyone. Whoever waits on a gap for a while fills it with
    // a "void" entry (first writer wins, the rules refuse a second write), the late writer's
    // sendAction retries with a fresh seq, and void entries are not delivered to the game.
    const fillGap = (seq: number) =>
      set(ref(db, `actions/${roomId}/${actionKey(seq)}`), { uid: user!.uid, seq, type: "void", payload: null, at: Date.now() }).catch(() => {});
    const off = onChildAdded(ref(db, `actions/${roomId}`), (s) => {
      const action = s.val() as GameAction;
      if (typeof action.seq !== "number" || action.seq < next) return;
      pending.set(action.seq, action);
      while (pending.has(next)) {
        const a = pending.get(next)!;
        pending.delete(next);
        if (a.type !== "void") frame.current?.contentWindow?.postMessage({ spd: "action", ...a }, window.location.origin);
        next++;
      }
      if (gapTimer) clearTimeout(gapTimer);
      gapTimer = null;
      if (pending.size > 0) {
        const missing = next;
        gapTimer = setTimeout(() => {
          if (!pending.has(missing) && pending.size > 0) void fillGap(missing);
        }, GAP_SECONDS * 1000);
      }
    });
    return () => {
      off();
      if (gapTimer) clearTimeout(gapTimer);
    };
  }, [roomId, user, gameReady]);

  const sendAction = useCallback(
    async (type: string, payload: unknown) => {
      const db = firebaseDb();
      // a reserved seq may already be taken (a client that waited on a gap fills it with a
      // "void" entry, see below) and the write is then refused: take a fresh seq and retry, so
      // an order is never lost silently
      for (let attempt = 0; attempt < 4; attempt++) {
        const result = await runTransaction(ref(db, `rooms/${roomId}/nextSeq`), (n: number | null) => (n ?? 0) + 1);
        const seq = result.snapshot.val() as number;
        const action: GameAction = { uid: user!.uid, seq, type, payload: payload ?? null, at: Date.now() };
        try {
          await set(ref(db, `actions/${roomId}/${actionKey(seq)}`), action);
          return;
        } catch (err) {
          console.warn(`action ${type} seq ${seq} refused (attempt ${attempt + 1})`, err);
        }
      }
      console.error(`action ${type} dropped after 4 attempts`);
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
          setTurn(
            typeof data.hero === "number"
              ? { hero: data.hero, epoch: Number(data.epoch ?? 0), danger: Boolean(data.danger) }
              : null,
          );
          setWaited(0);
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

  // skip timer: when the game waits for somebody else, every other client counts and, after
  // the limit, appends a "skip" order for that hero and turn. The game accepts the first skip
  // whose epoch still matches and drops the rest, so several clients may send one safely.
  // player order of the fixed party; the local index decides whose skip timer this client runs
  const order = useMemo(
    () => (players ? Object.entries(players).sort((a, b) => a[1].order - b[1].order).map(([uid]) => uid) : []),
    [players],
  );
  useEffect(() => {
    if (!turn || !gameReady || !user) return;
    if (turn.hero === order.indexOf(user.uid)) return;
    const limit = turn.danger ? SKIP_SECONDS_DANGER : SKIP_SECONDS;
    const started = Date.now();
    let fired = false;
    const id = setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000);
      setWaited(s);
      if (!fired && s >= limit) {
        fired = true;
        void sendAction("skip", `${turn.hero}:${turn.epoch}`);
      }
    }, 500);
    return () => clearInterval(id);
  }, [turn, gameReady, sendAction, order, user]);

  function skipNow() {
    if (turn) void sendAction("skip", `${turn.hero}:${turn.epoch}`);
  }

  function resync() {
    setGameReady(false);
    setTurn(null);
    setGeneration((g) => g + 1);
  }

  if (!room || !user || !players) {
    return (
      <main className="pd-muted p-10">
        Descending<span className="pd-blink">...</span>
      </main>
    );
  }

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
        <TurnOrder
          order={order}
          players={players}
          turnHero={turn?.hero ?? null}
          me={user.uid}
          waited={waited}
          limit={turn ? (turn.danger ? SKIP_SECONDS_DANGER : SKIP_SECONDS) : 0}
          onSkip={skipNow}
        />
      </div>
    </main>
  );
}

const ROW = 44;
// seconds another player may keep everyone waiting before their hero waits a turn (the story
// screen and badge popups at the start count too, so not too short)
const SKIP_SECONDS = 30;
const SKIP_SECONDS_DANGER = 45;
// the countdown is only shown for the last seconds, a timer on every turn feels like pressure
const COUNTDOWN_SECONDS = 10;
// a missing seq older than this is treated as abandoned and filled with a void entry
const GAP_SECONDS = 6;

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
  waited,
  limit,
  onSkip,
}: {
  order: string[];
  players: Record<string, RoomPlayer>;
  turnHero: number | null;
  me: string;
  waited: number;
  limit: number;
  onSkip: () => void;
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
            {active && myTurn && <span className="pd-positive pd-blink text-[10px]">YOU</span>}
            {active && !myTurn && limit > 0 && limit - waited <= COUNTDOWN_SECONDS && (
              <button
                type="button"
                onClick={onSkip}
                title="Make this hero wait a turn now"
                className="pd-btn pd-btn-grey pointer-events-auto px-1 text-[10px]"
              >
                {`${Math.max(0, limit - waited)}s`}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
