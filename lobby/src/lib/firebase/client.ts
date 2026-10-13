"use client";

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, signInAnonymously, type Auth, type User } from "firebase/auth";
import { getDatabase, type Database } from "firebase/database";

/**
 * Firebase is initialised lazily, on first use in the browser. "use client" modules are
 * still evaluated during prerendering on the server, where the public config may be absent
 * (for example on a Vercel build without env vars), and initialising there would fail the build.
 */
function app(): FirebaseApp {
  if (getApps().length) return getApp();
  return initializeApp({
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  });
}

export function firebaseAuth(): Auth {
  return getAuth(app());
}

export function firebaseDb(): Database {
  return getDatabase(app());
}

/** Resolves with the current user, signing in anonymously if needed. */
export async function ensureSignedIn(): Promise<User> {
  const auth = firebaseAuth();
  if (auth.currentUser) return auth.currentUser;
  const credential = await signInAnonymously(auth);
  return credential.user;
}

/** Bearer token for the Next.js route handlers. */
export async function authHeader(): Promise<HeadersInit> {
  const user = await ensureSignedIn();
  return { Authorization: `Bearer ${await user.getIdToken()}` };
}
