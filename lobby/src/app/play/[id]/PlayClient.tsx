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
 * The game also posts { spd: "turn", hero, epoch, danger, waiting, states } whenever the
 * simulation looks at the log for a hero (turn HUD, and the "skip" entries this page writes, see
 * the turn policy below) and { spd: "leave" } for "Main menu".
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
  // where the simulation stands, from the game: the hero whose act() is next (index in player
  // order), its order count (epoch, identical on every client), whether an enemy is in sight,
  // whether the game is parked on that hero right now, and every hero's state
  const [turn, setTurn] = useState<Turn | null>(null);
  // seconds since the current (hero, epoch) was first announced (strict-turn countdown)
  const [waited, setWaited] = useState(0);
  const turnStart = useRef<{ key: string; at: number } | null>(null);
  const sentSkip = useRef<string | null>(null);

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
              ? {
                  hero: data.hero,
                  epoch: Number(data.epoch ?? 0),
                  danger: Boolean(data.danger),
                  waiting: Boolean(data.waiting),
                  states: Array.isArray(data.states) ? data.states.map(String) : [],
                }
              : null,
          );
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

  // player order of the fixed party; the local index decides which hero is "mine"
  const order = useMemo(
    () => (players ? Object.entries(players).sort((a, b) => a[1].order - b[1].order).map(([uid]) => uid) : []),
    [players],
  );
  // turn policy: the game consumes one log entry per hero step, so somebody has to write
  // "nothing new" (skip hero:epoch) whenever a hero is busy walking or resting, and for an idle
  // hero while others move and no enemy is in sight (it lets the turn pass). The owner writes it
  // at once; the other clients after a short delay, in case the owner is absent (duplicates are
  // dropped by the game, the epoch no longer matches). A strict turn (idle hero, enemy in sight)
  // is only skipped after a long timeout, or by the countdown button.
  useEffect(() => {
    if (!turn || !gameReady || !user) return;
    const key = `${turn.hero}:${turn.epoch}`;
    if (turnStart.current?.key !== key) turnStart.current = { key, at: Date.now() };
    const started = turnStart.current.at;
    const myIndex = order.indexOf(user.uid);
    const mine = turn.hero === myIndex;
    const busy = turn.states[turn.hero] === "walk" || turn.states[turn.hero] === "rest";
    const othersBusy = turn.states.some((s, i) => i !== turn.hero && (s === "walk" || s === "rest"));
    const strict = !busy && turn.danger;
    let delay: number | null = null;
    if (!strict && (busy || othersBusy)) {
      delay = mine ? 0 : AFK_MS + AFK_STAGGER_MS * ((myIndex - turn.hero + order.length) % order.length);
    } else if (strict && !mine) {
      delay = SKIP_SECONDS_DANGER * 1000;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (delay !== null) {
      timer = setTimeout(
        () => {
          if (sentSkip.current === key) return;
          sentSkip.current = key;
          void sendAction("skip", key);
        },
        Math.max(0, delay - (Date.now() - started)),
      );
    }
    setWaited(Math.floor((Date.now() - started) / 1000));
    const ticker = strict ? setInterval(() => setWaited(Math.floor((Date.now() - started) / 1000)), 500) : null;
    return () => {
      if (timer) clearTimeout(timer);
      if (ticker) clearInterval(ticker);
    };
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
    // display names for in-game messages ("Not your turn: X is deciding")
    names: order.map((uid) => (players[uid]?.name ?? "?").replace(/,/g, " ")).join(","),
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
        <TurnOrder order={order} players={players} turn={turn} me={user.uid} waited={waited} onSkip={skipNow} />
      </div>
    </main>
  );
}

type Turn = { hero: number; epoch: number; danger: boolean; waiting: boolean; states: string[] };

const ROW = 44;
// seconds a player may keep everyone waiting on a strict turn (enemy in sight) before the
// other clients make their hero wait a turn
const SKIP_SECONDS_DANGER = 45;
// the countdown is only shown for the last seconds, a timer on every turn feels like pressure
const COUNTDOWN_SECONDS = 10;
// how long the other clients give a hero's owner to write its own "nothing new" entry before
// writing it for them (absent or hidden tab), staggered by player order
const AFK_MS = 700;
const AFK_STAGGER_MS = 300;
// a missing seq older than this is treated as abandoned and filled with a void entry
const GAP_SECONDS = 6;

const STATE_LABEL: Record<string, string> = { walk: "walking", rest: "resting", idle: "", dead: "dead" };

/**
 * Party HUD on the left (below the game's own status pane). While exploring, nobody waits for
 * anybody: rows keep the player order and show who is walking. While an enemy is in sight,
 * turns are strict: the hero whose decision the game waits for is on top and marked, the
 * player's own turn gets a banner, and the others see a countdown for the last seconds.
 */
function TurnOrder({
  order,
  players,
  turn,
  me,
  waited,
  onSkip,
}: {
  order: string[];
  players: Record<string, RoomPlayer>;
  turn: Turn | null;
  me: string;
  waited: number;
  onSkip: () => void;
}) {
  const heroState = (i: number) => turn?.states[i] ?? "idle";
  const strict = !!turn && turn.danger && heroState(turn.hero) === "idle";
  const start = strict ? turn!.hero : 0;
  const position = new Map<string, number>();
  order.forEach((uid, i) => position.set(uid, (i - start + order.length) % order.length));
  const myTurn = strict && order[turn!.hero] === me;
  const remaining = Math.max(0, SKIP_SECONDS_DANGER - waited);
  return (
    <>
      {strict && (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 select-none">
          {myTurn ? (
            <div className="pd-window pd-positive pd-blink px-4 py-1 text-base">YOUR TURN</div>
          ) : (
            <div className="pd-window pd-muted px-3 py-1 text-xs">
              Waiting for <span className="pd-warning">{players[order[turn!.hero]]?.name ?? "?"}</span>
            </div>
          )}
        </div>
      )}
      <div className="pointer-events-none absolute left-3 select-none" style={{ top: "28%", height: order.length * ROW + 18, width: 172 }}>
        <div className={`mb-1 text-[10px] ${turn?.danger ? "pd-negative" : "pd-muted"}`}>
          {turn ? (turn.danger ? "COMBAT: turns" : "EXPLORING: move freely") : ""}
        </div>
        <div className="relative" style={{ height: order.length * ROW }}>
          {order.map((uid, i) => {
            const p = players[uid];
            const pos = position.get(uid) ?? 0;
            const active = strict && pos === 0;
            const state = heroState(i);
            return (
              <div
                key={uid}
                className={`pd-window absolute left-0 flex items-center gap-2 px-2 py-1 transition-all duration-500 ease-in-out ${
                  active ? "opacity-100" : strict ? "opacity-60" : "opacity-85"
                }`}
                style={{ top: pos * ROW, transform: active ? "translateX(6px) scale(1.04)" : "none", width: 160 }}
              >
                <HeroSprite heroClass={p?.heroClass ?? "WARRIOR"} className="!h-[15px] !w-[12px]" />
                <div className="min-w-0 flex-1 leading-tight">
                  <div className={`truncate text-xs ${uid === me ? "pd-positive" : ""}`}>{p?.name ?? "?"}</div>
                  <div className="pd-muted text-[10px]">
                    {HERO_LABEL[p?.heroClass ?? "WARRIOR"]}
                    {STATE_LABEL[state] ? ` · ${STATE_LABEL[state]}` : ""}
                  </div>
                </div>
                {active && myTurn && <span className="pd-positive pd-blink text-[10px]">YOU</span>}
                {active && !myTurn && remaining > COUNTDOWN_SECONDS && <span className="pd-warning text-[10px]">turn</span>}
                {active && !myTurn && remaining <= COUNTDOWN_SECONDS && (
                  <button
                    type="button"
                    onClick={onSkip}
                    title="Make this hero wait a turn now"
                    className="pd-btn pd-btn-grey pointer-events-auto px-1 text-[10px]"
                  >
                    {`${remaining}s`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
