"use client";

import { useEffect, useState } from "react";
import { onValue, orderByChild, query, ref } from "firebase/database";
import type { User } from "firebase/auth";
import { firebaseDb } from "@/lib/firebase/client";
import type { Room } from "@/lib/rooms";

type RoomEntry = Room & { id: string };

/** `user` gates the subscription: the rules require auth, and a listener attached before
 *  sign-in completes is cancelled with permission_denied and never retried. */
export function RoomList({ user, onJoin }: { user: User | null; onJoin: (room: RoomEntry) => void }) {
  const [rooms, setRooms] = useState<RoomEntry[] | null>(null);

  useEffect(() => {
    if (!user) return;
    const roomsQuery = query(ref(firebaseDb(), "rooms"), orderByChild("createdAt"));
    return onValue(roomsQuery, (snapshot) => {
      const list: RoomEntry[] = [];
      snapshot.forEach((child) => {
        list.push({ id: child.key!, ...(child.val() as Room) });
      });
      setRooms(list.filter((r) => r.status === "waiting").reverse());
    });
  }, [user]);

  if (rooms === null) return <p className="text-zinc-500">Loading rooms…</p>;
  if (rooms.length === 0) return <p className="text-zinc-500">No open rooms. Create one.</p>;

  return (
    <ul className="divide-y divide-zinc-800 rounded border border-zinc-800">
      {rooms.map((room) => (
        <li key={room.id} className="flex items-center justify-between px-3 py-2">
          <div>
            <span className="font-medium">{room.name}</span>
            <span className="ml-2 text-sm text-zinc-500">
              {room.playerCount}/{room.maxPlayers}
              {room.hasPassword ? " · locked" : ""}
            </span>
          </div>
          <button
            className="rounded bg-emerald-700 px-3 py-1 text-sm hover:bg-emerald-600 disabled:opacity-50"
            disabled={room.playerCount >= room.maxPlayers}
            onClick={() => onJoin(room)}
          >
            Join
          </button>
        </li>
      ))}
    </ul>
  );
}
