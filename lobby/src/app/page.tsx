"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { authHeader } from "@/lib/firebase/client";
import { NicknameField } from "@/components/NicknameField";
import { RoomList } from "@/components/RoomList";
import { Button, Input, TitleBanner, Window } from "@/components/pd";

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
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `failed to create room (${res.status})`);
      router.push(`/rooms/${data.roomId}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function joinRoom(room: { id: string; hasPassword: boolean }) {
    setError(null);
    const pw = room.hasPassword ? window.prompt("This party is guarded. Password?") : "";
    if (room.hasPassword && pw === null) return;
    try {
      const res = await fetch(`/api/rooms/${room.id}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ nickname, password: pw ?? "" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `failed to join (${res.status})`);
      router.push(`/rooms/${room.id}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 pb-16 pt-10">
      <header className="flex flex-col items-center gap-3 text-center">
        <TitleBanner />
        <p className="pd-title pd-shadow text-2xl">MULTI</p>
        <p className="pd-shadow max-w-md">
          Up to four heroes descend together. One dungeon, one seed, turns like the mobs take them.
        </p>
      </header>

      <Window>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <NicknameField value={nickname} onChange={setNickname} />
          <span className={`text-sm ${user ? "pd-positive" : "pd-muted"}`}>
            {user ? "● connected" : "○ connecting…"}
          </span>
        </div>
      </Window>

      <Window title="Parties gathering">
        <RoomList user={user} onJoin={joinRoom} />
      </Window>

      <Window title="Found a party">
        <form onSubmit={createRoom} className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row">
            <Input
              className="flex-1"
              placeholder="Party name"
              value={roomName}
              required
              minLength={2}
              maxLength={32}
              onChange={(e) => setRoomName(e.target.value)}
            />
            <Input
              className="sm:w-48"
              placeholder="Password (optional)"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-4">
            <Button type="submit" disabled={busy || !user}>
              Enter the Dungeon
            </Button>
            {error && <span className="pd-negative text-sm">{error}</span>}
          </div>
        </form>
      </Window>

      <footer className="pd-muted pd-shadow text-center text-sm">
        A GPLv3 fork of{" "}
        <a className="underline" href="https://github.com/00-Evan/shattered-pixel-dungeon">
          Shattered Pixel Dungeon
        </a>{" "}
        by Evan Debenham.{" "}
        <a className="underline" href="https://github.com/juliuszmandrosz/shattered-pixel-dungeon-multi">
          Source
        </a>
      </footer>
    </main>
  );
}
