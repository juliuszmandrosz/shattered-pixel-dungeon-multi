"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { authHeader } from "@/lib/firebase/client";
import { NicknameField } from "@/components/NicknameField";
import { RoomList } from "@/components/RoomList";

export default function Home() {
  const router = useRouter();
  const { user, nickname, setNickname } = useAuth();
  const [roomName, setRoomName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createRoom(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ name: roomName, nickname, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "failed to create room");
      router.push(`/rooms/${data.roomId}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function joinRoom(room: { id: string; hasPassword: boolean }) {
    setError(null);
    const pw = room.hasPassword ? window.prompt("Room password") : "";
    if (room.hasPassword && pw === null) return;
    try {
      const res = await fetch(`/api/rooms/${room.id}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ nickname, password: pw ?? "" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "failed to join");
      router.push(`/rooms/${room.id}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-10">
      <header>
        <h1 className="text-3xl font-bold">Shattered Pixel Dungeon Multi</h1>
        <p className="mt-2 text-zinc-400">
          Co-op roguelike in the browser. Up to four heroes, one dungeon, turn based.
        </p>
      </header>

      <section className="flex items-center justify-between">
        <NicknameField value={nickname} onChange={setNickname} />
        <span className="text-xs text-zinc-600">{user ? "connected" : "connecting…"}</span>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Open rooms</h2>
        <RoomList user={user} onJoin={joinRoom} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Create a room</h2>
        <form onSubmit={createRoom} className="flex flex-col gap-2 sm:flex-row">
          <input
            className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1"
            placeholder="Room name"
            value={roomName}
            required
            minLength={2}
            maxLength={32}
            onChange={(e) => setRoomName(e.target.value)}
          />
          <input
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1"
            placeholder="Password (optional)"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            className="rounded bg-emerald-700 px-4 py-1 hover:bg-emerald-600 disabled:opacity-50"
            disabled={busy || !user}
          >
            Create
          </button>
        </form>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </section>

      <footer className="text-xs text-zinc-600">
        Based on{" "}
        <a className="underline" href="https://github.com/00-Evan/shattered-pixel-dungeon">
          Shattered Pixel Dungeon
        </a>{" "}
        by Evan Debenham, GPLv3.{" "}
        <a className="underline" href="https://github.com/juliuszmandrosz/shattered-pixel-dungeon-multi">
          Source
        </a>
        .
      </footer>
    </main>
  );
}
