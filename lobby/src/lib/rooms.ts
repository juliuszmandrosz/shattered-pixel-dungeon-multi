/**
 * Realtime Database layout (see database.rules.json for who may read/write what):
 *
 * rooms/{roomId}             public room card, written by the route handlers (admin)
 * roomSecrets/{roomId}       password hash, never readable by clients
 * roomPlayers/{roomId}/{uid} members in join order, players update their own heroClass/ready
 * presence/{roomId}/{uid}    online flag cleared by onDisconnect
 * rooms/{roomId}/nextSeq     counter bumped by a transaction for every action (players may write it)
 * actions/{roomId}/{seq}     append-only stream of game actions keyed by the zero-padded seq
 */

export const MAX_PLAYERS = 4;

export const HERO_CLASSES = ["WARRIOR", "MAGE", "ROGUE", "HUNTRESS", "DUELIST", "CLERIC"] as const;
export type HeroClass = (typeof HERO_CLASSES)[number];

export type RoomStatus = "waiting" | "playing" | "ended";

export interface Room {
  name: string;
  hostId: string;
  status: RoomStatus;
  maxPlayers: number;
  hasPassword: boolean;
  playerCount: number;
  seed: number | null;
  createdAt: number;
  startedAt: number | null;
}

export interface RoomPlayer {
  name: string;
  heroClass: HeroClass;
  ready: boolean;
  order: number;
  joinedAt: number;
}

export interface GameAction {
  uid: string;
  seq: number;
  type: string;
  payload: unknown;
  at: number;
}

export function roomPath(roomId: string) {
  return `rooms/${roomId}`;
}
export function playersPath(roomId: string) {
  return `roomPlayers/${roomId}`;
}
export function presencePath(roomId: string, uid: string) {
  return `presence/${roomId}/${uid}`;
}
export function actionsPath(roomId: string) {
  return `actions/${roomId}`;
}
/** Zero-padded key so the database orders actions by seq. */
export function actionKey(seq: number) {
  return String(seq).padStart(8, "0");
}

export function isValidRoomName(name: string) {
  return name.trim().length >= 2 && name.trim().length <= 32;
}

/** Nickname lives in localStorage, anonymous accounts have no profile. */
export const NICKNAME_KEY = "spd.nickname";

export function randomNickname() {
  const adjectives = ["Brave", "Sneaky", "Grumpy", "Lucky", "Hungry", "Tiny"];
  const nouns = ["Rat", "Gnoll", "Crab", "Goo", "Bat", "Warlock"];
  const pick = (list: readonly string[]) => list[Math.floor(Math.random() * list.length)];
  return `${pick(adjectives)}${pick(nouns)}${Math.floor(Math.random() * 90 + 10)}`;
}
