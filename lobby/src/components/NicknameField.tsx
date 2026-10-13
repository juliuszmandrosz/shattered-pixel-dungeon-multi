"use client";

export function NicknameField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-zinc-400">
      Nickname
      <input
        className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-100"
        value={value}
        maxLength={20}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
