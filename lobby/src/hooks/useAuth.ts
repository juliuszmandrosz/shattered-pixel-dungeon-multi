"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth, ensureSignedIn } from "@/lib/firebase/client";
import { NICKNAME_KEY, randomNickname } from "@/lib/rooms";

/** Anonymous Firebase session plus a locally stored nickname. */
export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [nickname, setNicknameState] = useState<string>("");

  useEffect(() => {
    const stored = window.localStorage.getItem(NICKNAME_KEY) ?? randomNickname();
    window.localStorage.setItem(NICKNAME_KEY, stored);
    setNicknameState(stored);

    const unsubscribe = onAuthStateChanged(auth, (current) => setUser(current));
    ensureSignedIn().catch((error) => console.error("anonymous sign-in failed", error));
    return unsubscribe;
  }, []);

  const setNickname = (value: string) => {
    const trimmed = value.trim().slice(0, 20);
    window.localStorage.setItem(NICKNAME_KEY, trimmed);
    setNicknameState(trimmed);
  };

  return { user, nickname, setNickname };
}
