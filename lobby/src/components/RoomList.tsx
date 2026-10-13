"use client";

import { useEffect, useState } from "react";
import { onValue, orderByChild, query, ref } from "firebase/database";
import type { User } from "firebase/auth";
import { firebaseDb } from "@/lib/firebase/client";
import type { Room } from "@/lib/rooms";
import { Button } from "@/components/pd";

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

  if (rooms === null) {
    return (
      <p className="pd-muted px-2 py-3">
        Searching for parties<span className="pd-blink">...</span>
      </p>
    );
  }
  if (rooms.length === 0) {
    return <p className="pd-muted px-2 py-3">No party is gathering right now. Found your own below.</p>;
  }

  return (
    <ul>
      {rooms.map((room) => {
        const full = room.playerCount >= room.maxPlayers;
        return (
          <li key={room.id} className="pd-row">
            <div className="flex-1 min-w-0">
              <div className="truncate">{room.name}</div>
              <div className="text-sm">
                <span className={full ? "pd-negative" : "pd-positive"}>
                  {room.playerCount}/{room.maxPlayers} heroes
                </span>
                {room.hasPassword && <span className="pd-warning"> · password</span>}
              </div>
            </div>
            <Button variant="grey" disabled={full} onClick={() => onJoin(room)}>
              {full ? "Full" : "Join"}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
