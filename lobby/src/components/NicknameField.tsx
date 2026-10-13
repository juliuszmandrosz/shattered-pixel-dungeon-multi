"use client";

import { Input } from "@/components/pd";

export function NicknameField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-3">
      <span className="pd-muted">Name</span>
      <Input value={value} maxLength={20} onChange={(e) => onChange(e.target.value)} className="w-44" />
    </label>
  );
}
