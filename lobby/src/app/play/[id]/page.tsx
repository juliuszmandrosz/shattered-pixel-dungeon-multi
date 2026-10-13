import { Suspense } from "react";
import { PlayClient } from "./PlayClient";

// params are read inside a client component under Suspense so the shell can be prerendered
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<main className="p-10 text-zinc-500">Loading…</main>}>
      <PlayClient params={params} />
    </Suspense>
  );
}
