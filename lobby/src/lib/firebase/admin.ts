import "server-only";

import { JWT } from "google-auth-library";
import { createRemoteJWKSet, jwtVerify } from "jose";

/**
 * Server-side access to Firebase without the firebase-admin SDK (its auth module cannot be
 * loaded in the Vercel Node runtime: jwks-rsa does a CommonJS require() of the ESM `jose`).
 *
 * - ID tokens from the browser are verified with jose against Google's public keys.
 * - Realtime Database is accessed through its REST API with an OAuth token minted from the
 *   service account, which bypasses security rules like the admin SDK would.
 */

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!;
const DATABASE_URL = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL!;

const jwks = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
);

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Verifies the Firebase ID token from an Authorization: Bearer header. Returns the uid. */
export async function requireUid(request: Request): Promise<string> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new HttpError(401, "missing bearer token");
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `https://securetoken.google.com/${PROJECT_ID}`,
      audience: PROJECT_ID,
    });
    if (!payload.sub) throw new Error("no subject");
    return payload.sub;
  } catch {
    throw new HttpError(401, "invalid token");
  }
}

let serviceClient: JWT | null = null;

function serviceAccount(): JWT {
  if (serviceClient) return serviceClient;
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) throw new Error("FIREBASE_SERVICE_ACCOUNT_B64 is not set (see .env.example)");
  const key = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  serviceClient = new JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ["https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/firebase.database"],
  });
  return serviceClient;
}

async function dbFetch(path: string, init: RequestInit & { query?: Record<string, string> } = {}) {
  const { token } = await serviceAccount().getAccessToken();
  const url = new URL(`${path.replace(/^\/+/, "")}.json`, DATABASE_URL.endsWith("/") ? DATABASE_URL : DATABASE_URL + "/");
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`RTDB ${init.method ?? "GET"} ${path} failed: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

/** Admin-privileged Realtime Database helpers (security rules are bypassed). */
export const rtdb = {
  get<T = unknown>(path: string): Promise<T | null> {
    return dbFetch(path) as Promise<T | null>;
  },
  /** Multi-location update, keys are paths relative to `path`. */
  update(path: string, values: Record<string, unknown>): Promise<void> {
    return dbFetch(path || "/", { method: "PATCH", body: JSON.stringify(values) }).then(() => undefined);
  },
  set(path: string, value: unknown): Promise<void> {
    return dbFetch(path, { method: "PUT", body: JSON.stringify(value) }).then(() => undefined);
  },
  remove(path: string): Promise<void> {
    return dbFetch(path, { method: "DELETE" }).then(() => undefined);
  },
};

/** Firebase push id: 20 chars, chronologically sortable, same algorithm as the client SDK. */
const PUSH_CHARS = "-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz";
export function pushId(now = Date.now()): string {
  let ts = now;
  const stamp = new Array<string>(8);
  for (let i = 7; i >= 0; i--) {
    stamp[i] = PUSH_CHARS.charAt(ts % 64);
    ts = Math.floor(ts / 64);
  }
  let random = "";
  for (let i = 0; i < 12; i++) random += PUSH_CHARS.charAt(Math.floor(Math.random() * 64));
  return stamp.join("") + random;
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  console.error(error);
  return Response.json({ error: "internal error" }, { status: 500 });
}
