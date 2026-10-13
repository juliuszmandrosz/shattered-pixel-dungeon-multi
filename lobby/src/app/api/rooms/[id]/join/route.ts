import { scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { adminDb, errorResponse, HttpError, requireUid } from "@/lib/firebase/admin";
import type { Room, RoomPlayer } from "@/lib/rooms";

const scryptAsync = promisify(scrypt);

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hashHex] = stored.split(":");
  const hash = (await scryptAsync(password, salt, 32)) as Buffer;
  const expected = Buffer.from(hashHex, "hex");
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}

/** POST /api/rooms/:id/join  { nickname, password? }  -> { ok: true } */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const uid = await requireUid(request);
    const { id: roomId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const nickname = String(body.nickname ?? "").trim().slice(0, 20) || "Player";
    const password = typeof body.password === "string" ? body.password : "";

    const db = adminDb();
    const roomSnap = await db.ref(`rooms/${roomId}`).get();
    if (!roomSnap.exists()) throw new HttpError(404, "room not found");
    const room = roomSnap.val() as Room;

    const existing = await db.ref(`roomPlayers/${roomId}/${uid}`).get();
    if (existing.exists()) return Response.json({ ok: true, rejoined: true });

    if (room.status !== "waiting") throw new HttpError(409, "game already started");

    if (room.hasPassword) {
      const secret = (await db.ref(`roomSecrets/${roomId}`).get()).val();
      if (!secret || !(await verifyPassword(password, secret.passwordHash))) {
        throw new HttpError(403, "wrong password");
      }
    }

    const playersSnap = await db.ref(`roomPlayers/${roomId}`).get();
    const players = (playersSnap.val() ?? {}) as Record<string, RoomPlayer>;
    const count = Object.keys(players).length;
    if (count >= room.maxPlayers) throw new HttpError(409, "room is full");

    const order = Math.max(-1, ...Object.values(players).map((p) => p.order)) + 1;
    const player: RoomPlayer = { name: nickname, heroClass: "WARRIOR", ready: false, order, joinedAt: Date.now() };

    await db.ref().update({
      [`roomPlayers/${roomId}/${uid}`]: player,
      [`rooms/${roomId}/playerCount`]: count + 1,
    });

    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
