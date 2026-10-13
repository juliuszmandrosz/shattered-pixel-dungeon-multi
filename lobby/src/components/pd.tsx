"use client";

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import type { HeroClass } from "@/lib/rooms";

/** Window chrome from the game (interfaces/chrome.png), with an optional yellow title like WndTitledMessage. */
export function Window({ title, children, className = "" }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`pd-window bg-[#1c1b23]/95 ${className}`}>
      {title && <h2 className="pd-title mb-3 text-lg">{title}</h2>}
      {children}
    </section>
  );
}

export function Button({
  variant = "red",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "red" | "grey" }) {
  return <button className={`pd-btn ${variant === "red" ? "pd-btn-red" : "pd-btn-grey"} ${className}`} {...props} />;
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`pd-input ${className}`} {...props} />;
}

export function HeroSprite({ heroClass, className = "" }: { heroClass: HeroClass; className?: string }) {
  return (
    <img
      src={`/ui/hero-${heroClass.toLowerCase()}.png`}
      alt={heroClass.toLowerCase()}
      className={`pd-sprite ${className}`}
      draggable={false}
    />
  );
}

export function TitleBanner({ className = "" }: { className?: string }) {
  return (
    <img
      src="/ui/title-wide.png"
      alt="Shattered Pixel Dungeon"
      width={480}
      height={108}
      className={`pixel pd-torch mx-auto h-auto w-full max-w-[480px] ${className}`}
      draggable={false}
    />
  );
}

export const HERO_LABEL: Record<HeroClass, string> = {
  WARRIOR: "Warrior",
  MAGE: "Mage",
  ROGUE: "Rogue",
  HUNTRESS: "Huntress",
  DUELIST: "Duelist",
  CLERIC: "Cleric",
};
