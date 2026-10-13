import { scrypt, randomBytes, randomInt } from "node:crypto";
import { promisify } from "node:util";
import { adminDb, errorResponse, HttpError, requireUid } from "@/lib/firebase/admin";
import { isValidRoomName, MAX_PLAYERS, type Room, type RoomPlayer } from "@/lib/rooms";

const scryptAsync = promisify(scrypt);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scryptAsync(password, salt, 32)) as Buffer;
  return `${salt}:${hash.toString("hex")}`;
}

/** POST /api/rooms  { name, nickname, password? }  -> { roomId } */
export async function POST(request: Request) {
  try {
    const uid = await requireUid(request);
    const body = await request.json().catch(() => ({}));
    const name = String(body.name ?? "");
    const nickname = String(body.nickname ?? "").trim().slice(0, 20) || "Host";
    const password = typeof body.password === "string" ? body.password : "";

    if (!isValidRoomName(name)) throw new HttpError(400, "room name must be 2-32 characters");

    const db = adminDb();
    const roomRef = db.ref("rooms").push();
    const roomId = roomRef.key!;
    const now = Date.now();

    const room: Room = {
      name: name.trim(),
      hostId: uid,
      status: "waiting",
      maxPlayers: MAX_PLAYERS,
      hasPassword: password.length > 0,
      playerCount: 1,
      seed: null,
      createdAt: now,
      startedAt: null,
    };
    const host: RoomPlayer = { name: nickname, heroClass: "WARRIOR", ready: false, order: 0, joinedAt: now };

    const updates: Record<string, unknown> = {
      [`rooms/${roomId}`]: room,
      [`roomPlayers/${roomId}/${uid}`]: host,
    };
    if (password) {
      updates[`roomSecrets/${roomId}`] = { passwordHash: await hashPassword(password) };
    }
    await db.ref().update(updates);

    return Response.json({ roomId });
  } catch (error) {
    return errorResponse(error);
  }
}

export function newSeed() {
  // Shattered seeds are 0 .. 5429503678975 (26^9 - 1), encoded in game as XXX-XXX-XXX
  return randomInt(0, 5429503678976);
}
