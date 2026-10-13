import { randomInt } from "node:crypto";
import { errorResponse, HttpError, requireUid, rtdb } from "@/lib/firebase/admin";
import type { Room } from "@/lib/rooms";

/** POST /api/rooms/:id/start  (host only) -> { seed } */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const uid = await requireUid(request);
    const { id: roomId } = await context.params;

    const room = await rtdb.get<Room>(`rooms/${roomId}`);
    if (!room) throw new HttpError(404, "room not found");
    if (room.hostId !== uid) throw new HttpError(403, "only the host can start");
    if (room.status !== "waiting") throw new HttpError(409, "already started");

    // Shattered seeds are 0 .. 26^9 - 1, shown in game as XXX-XXX-XXX
    const seed = randomInt(0, 5429503678976);
    await rtdb.update(`rooms/${roomId}`, { status: "playing", seed, startedAt: Date.now() });

    return Response.json({ seed });
  } catch (error) {
    return errorResponse(error);
  }
}
