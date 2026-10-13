"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onDisconnect, onValue, ref, remove, set, update } from "firebase/database";
import { useAuth } from "@/hooks/useAuth";
import { authHeader, firebaseDb } from "@/lib/firebase/client";
import { HERO_CLASSES, type HeroClass, type Room, type RoomPlayer } from "@/lib/rooms";

type Players = Record<string, RoomPlayer>;
type Presence = Record<string, { online: boolean }>;

export function RoomClient({ params }: { params: Promise<{ id: string }> }) {
  const { id: roomId } = use(params);
  const router = useRouter();
  const { user, nickname } = useAuth();
  const [room, setRoom] = useState<Room | null | undefined>(undefined);
  const [players, setPlayers] = useState<Players>({});
  const [presence, setPresence] = useState<Presence>({});
  const [error, setError] = useState<string | null>(null);

  // room card, players, presence (listeners need an authenticated user, see RoomList)
  useEffect(() => {
    if (!user) return;
    const offRoom = onValue(ref(firebaseDb(), `rooms/${roomId}`), (s) => setRoom(s.exists() ? (s.val() as Room) : null));
    const offPlayers = onValue(ref(firebaseDb(), `roomPlayers/${roomId}`), (s) => setPlayers((s.val() as Players) ?? {}));
    const offPresence = onValue(ref(firebaseDb(), `presence/${roomId}`), (s) => setPresence((s.val() as Presence) ?? {}));
    return () => {
      offRoom();
      offPlayers();
      offPresence();
    };
  }, [roomId, user]);

  // own presence with server-side cleanup on disconnect
  useEffect(() => {
    if (!user) return;
    const me = ref(firebaseDb(), `presence/${roomId}/${user.uid}`);
    set(me, { online: true });
    onDisconnect(me).remove();
    return () => {
      remove(me);
    };
  }, [roomId, user]);

  // everyone follows the host into the game
  useEffect(() => {
    if (room?.status === "playing") router.replace(`/play/${roomId}`);
  }, [room?.status, roomId, router]);

  const me = user ? players[user.uid] : undefined;
  const isHost = !!user && room?.hostId === user.uid;
  const ordered = Object.entries(players).sort((a, b) => a[1].order - b[1].order);

  async function setHeroClass(heroClass: HeroClass) {
    if (!user || !me) return;
    await update(ref(firebaseDb(), `roomPlayers/${roomId}/${user.uid}`), { heroClass, name: nickname || me.name });
  }

  async function toggleReady() {
    if (!user || !me) return;
    await update(ref(firebaseDb(), `roomPlayers/${roomId}/${user.uid}`), { ready: !me.ready });
  }

  async function startGame() {
    setError(null);
    const res = await fetch(`/api/rooms/${roomId}/start`, { method: "POST", headers: await authHeader() });
    if (!res.ok) setError((await res.json()).error ?? "failed to start");
  }

  if (room === undefined) return <main className="p-10 text-zinc-500">Loading room…</main>;
  if (room === null) return <main className="p-10 text-zinc-500">Room not found.</main>;
  if (user && !me) {
    return (
      <main className="p-10 text-zinc-400">
        You are not in this room. <a className="underline" href="/">Back to the lobby</a>.
      </main>
    );
  }

  const everyoneReady = ordered.length > 0 && ordered.every(([, p]) => p.ready);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">{room.name}</h1>
        <span className="text-sm text-zinc-500">
          {ordered.length}/{room.maxPlayers} players{room.hasPassword ? " · locked" : ""}
        </span>
      </header>

      <ul className="divide-y divide-zinc-800 rounded border border-zinc-800">
        {ordered.map(([uid, p]) => (
          <li key={uid} className="flex items-center justify-between px-3 py-2">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${presence[uid]?.online ? "bg-emerald-500" : "bg-zinc-600"}`} />
              <span className="font-medium">{p.name}</span>
              {uid === room.hostId && <span className="text-xs text-amber-400">host</span>}
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-zinc-400">{p.heroClass.toLowerCase()}</span>
              <span className={p.ready ? "text-emerald-400" : "text-zinc-500"}>{p.ready ? "ready" : "not ready"}</span>
            </div>
          </li>
        ))}
      </ul>

      {me && (
        <section className="flex flex-col gap-3 rounded border border-zinc-800 p-3">
          <div className="flex flex-wrap gap-2">
            {HERO_CLASSES.map((c) => (
              <button
                key={c}
                onClick={() => setHeroClass(c)}
                className={`rounded px-3 py-1 text-sm ${
                  me.heroClass === c ? "bg-emerald-700" : "bg-zinc-800 hover:bg-zinc-700"
                }`}
              >
                {c.toLowerCase()}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={toggleReady} className="rounded bg-zinc-800 px-4 py-1 hover:bg-zinc-700">
              {me.ready ? "Not ready" : "Ready"}
            </button>
            {isHost && (
              <button
                onClick={startGame}
                disabled={!everyoneReady}
                className="rounded bg-emerald-700 px-4 py-1 hover:bg-emerald-600 disabled:opacity-50"
              >
                Start game
              </button>
            )}
            {isHost && !everyoneReady && <span className="text-xs text-zinc-500">waiting for everyone to be ready</span>}
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </section>
      )}

      <a className="text-sm text-zinc-500 underline" href="/">
        Back to the lobby
      </a>
    </main>
  );
}
