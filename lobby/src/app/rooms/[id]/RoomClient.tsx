"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onDisconnect, onValue, ref, remove, set, update } from "firebase/database";
import { useAuth } from "@/hooks/useAuth";
import { authHeader, firebaseDb } from "@/lib/firebase/client";
import { HERO_CLASSES, type HeroClass, type Room, type RoomPlayer } from "@/lib/rooms";
import { Button, HERO_LABEL, HeroSprite, Window } from "@/components/pd";

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
    const db = firebaseDb();
    const offRoom = onValue(ref(db, `rooms/${roomId}`), (s) => setRoom(s.exists() ? (s.val() as Room) : null));
    const offPlayers = onValue(ref(db, `roomPlayers/${roomId}`), (s) => setPlayers((s.val() as Players) ?? {}));
    const offPresence = onValue(ref(db, `presence/${roomId}`), (s) => setPresence((s.val() as Presence) ?? {}));
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
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? "failed to start");
  }

  if (room === undefined) {
    return (
      <main className="pd-muted p-10">
        Entering the party<span className="pd-blink">...</span>
      </main>
    );
  }
  if (room === null) return <main className="pd-muted p-10">This party has disbanded.</main>;
  if (user && !me) {
    return (
      <main className="p-10">
        <Window title="Not your party">
          <p className="mb-4">You have not joined this party.</p>
          <a href="/">
            <Button variant="grey">Back to the surface</Button>
          </a>
        </Window>
      </main>
    );
  }

  const everyoneReady = ordered.length > 0 && ordered.every(([, p]) => p.ready);
  const slots = Array.from({ length: room.maxPlayers }, (_, i) => ordered[i] ?? null);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 pb-16 pt-10">
      <header className="text-center">
        <h1 className="pd-title pd-shadow text-2xl">{room.name}</h1>
        <p className="pd-muted text-sm">
          {ordered.length}/{room.maxPlayers} heroes{room.hasPassword ? " · guarded by a password" : ""}
        </p>
      </header>

      <Window title="The party">
        <ul>
          {slots.map((slot, i) =>
            slot ? (
              <li key={slot[0]} className="pd-row">
                <HeroSprite heroClass={slot[1].heroClass} />
                <div className="flex-1 min-w-0">
                  <div className="truncate">
                    {slot[1].name}
                    {slot[0] === room.hostId && <span className="pd-warning text-sm"> · leader</span>}
                  </div>
                  <div className="pd-muted text-sm">{HERO_LABEL[slot[1].heroClass]}</div>
                </div>
                <div className="text-right text-sm">
                  <div className={presence[slot[0]]?.online ? "pd-positive" : "pd-muted"}>
                    {presence[slot[0]]?.online ? "here" : "away"}
                  </div>
                  <div className={slot[1].ready ? "pd-positive" : "pd-muted"}>{slot[1].ready ? "ready" : "not ready"}</div>
                </div>
              </li>
            ) : (
              <li key={`empty-${i}`} className="pd-row pd-muted">
                <div className="pd-sprite" />
                <div className="flex-1">an empty seat by the fire</div>
              </li>
            ),
          )}
        </ul>
      </Window>

      {me && (
        <Window title="Choose your hero">
          <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {HERO_CLASSES.map((c) => (
              <Button
                key={c}
                variant={me.heroClass === c ? "red" : "grey"}
                onClick={() => setHeroClass(c)}
                className="flex-col gap-1 py-2"
              >
                <HeroSprite heroClass={c} />
                <span className="text-sm">{HERO_LABEL[c]}</span>
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant={me.ready ? "grey" : "red"} onClick={toggleReady}>
              {me.ready ? "Not ready" : "Ready"}
            </Button>
            {isHost && (
              <Button onClick={startGame} disabled={!everyoneReady}>
                Descend
              </Button>
            )}
            {isHost && !everyoneReady && <span className="pd-muted text-sm">waiting for everyone to be ready</span>}
            {error && <span className="pd-negative text-sm">{error}</span>}
          </div>
        </Window>
      )}

      <a href="/" className="pd-muted pd-shadow text-center text-sm underline">
        Back to the surface
      </a>
    </main>
  );
}
