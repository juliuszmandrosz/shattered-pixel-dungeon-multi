"use client";

import { use, useEffect, useRef, useState } from "react";
import { onChildAdded, onValue, push, ref } from "firebase/database";
import { useAuth } from "@/hooks/useAuth";
import { firebaseDb } from "@/lib/firebase/client";
import type { GameAction, Room, RoomPlayer } from "@/lib/rooms";

/**
 * Hosts the TeaVM build of the game in an iframe and bridges it to the room's
 * action stream in Realtime Database:
 *   game -> page   postMessage({ spd: "action", type, payload })  -> push to actions/{room}
 *   page -> game   actions/{room} child_added -> postMessage({ spd: "action", ... }) into the iframe
 * The game ignores these messages until the co-op engine work lands; single player works today.
 */
export function PlayClient({ params }: { params: Promise<{ id: string }> }) {
  const { id: roomId } = use(params);
  const { user } = useAuth();
  const frame = useRef<HTMLIFrameElement>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Record<string, RoomPlayer>>({});
  const seq = useRef(0);

  useEffect(() => {
    if (!user) return;
    const offRoom = onValue(ref(firebaseDb(), `rooms/${roomId}`), (s) => setRoom((s.val() as Room) ?? null));
    const offPlayers = onValue(ref(firebaseDb(), `roomPlayers/${roomId}`), (s) => setPlayers((s.val() as Record<string, RoomPlayer>) ?? {}));
    return () => {
      offRoom();
      offPlayers();
    };
  }, [roomId, user]);

  // actions from the database into the game
  useEffect(() => {
    if (!user) return;
    return onChildAdded(ref(firebaseDb(), `actions/${roomId}`), (s) => {
      const action = s.val() as GameAction;
      frame.current?.contentWindow?.postMessage({ spd: "action", id: s.key, ...action }, window.location.origin);
    });
  }, [roomId, user]);

  // actions from the game into the database
  useEffect(() => {
    if (!user) return;
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.spd !== "action") return;
      const action: GameAction = { uid: user!.uid, seq: seq.current++, type: String(data.type), payload: data.payload ?? null, at: Date.now() };
      push(ref(firebaseDb(), `actions/${roomId}`), action);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [roomId, user]);

  if (!room || !user) return <main className="p-10 text-zinc-500">Loading game…</main>;

  const order = Object.entries(players)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([uid]) => uid);
  const query = new URLSearchParams({
    room: roomId,
    player: user.uid,
    seed: String(room.seed ?? ""),
    order: order.join(","),
    heroClass: players[user.uid]?.heroClass ?? "WARRIOR",
  });

  return (
    <main className="flex h-screen flex-col bg-black">
      <div className="flex items-center justify-between px-3 py-1 text-xs text-zinc-500">
        <span>{room.name} · seed {room.seed}</span>
        <span>{order.map((uid) => players[uid]?.name).join(", ")}</span>
      </div>
      <iframe
        ref={frame}
        title="Shattered Pixel Dungeon"
        src={`/game/index.html?${query.toString()}`}
        className="h-full w-full flex-1 border-0"
        allow="autoplay; fullscreen; gamepad"
      />
    </main>
  );
}
