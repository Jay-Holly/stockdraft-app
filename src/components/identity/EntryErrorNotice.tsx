"use client";

import { useState } from "react";
import { IDENTITY_NOT_VERIFIED_MESSAGE } from "@/lib/identity/messages";

export function EntryErrorNotice({ error }: { error: string }) {
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  if (error !== IDENTITY_NOT_VERIFIED_MESSAGE) {
    return <p className="text-red-400 text-sm text-center">{error}</p>;
  }

  async function startVerification() {
    setStarting(true);
    setStartError(null);
    try {
      const response = await fetch("/api/identity/start", { method: "POST" });
      const data = await response.json();
      if (!response.ok) {
        setStartError(data.error ?? "Could not start verification.");
        setStarting(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setStartError("Could not start verification.");
      setStarting(false);
    }
  }

  return (
    <div className="rounded-lg border border-gold/30 bg-gold/5 px-4 py-3 text-center space-y-2">
      <p className="text-sm text-white">{error}</p>
      <button
        type="button"
        disabled={starting}
        onClick={startVerification}
        className="rounded-lg bg-gold text-black font-semibold px-4 py-2 text-sm hover:brightness-95 disabled:opacity-40"
      >
        {starting ? "Starting verification..." : "Verify Identity"}
      </button>
      {startError && <p className="text-red-400 text-sm">{startError}</p>}
    </div>
  );
}
