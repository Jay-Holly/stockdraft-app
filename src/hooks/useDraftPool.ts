"use client";

import { useEffect, useState } from "react";
import type { DraftPoolStock } from "@/lib/market/draft-pool";

export function useDraftPool() {
  const [stocks, setStocks] = useState<DraftPoolStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/draft/pool");
        const data = await res.json();

        if (cancelled) return;

        if (!res.ok) {
          setError(data.error ?? "Could not load draft pool");
          setStocks([]);
          return;
        }

        setStocks(data.stocks ?? []);
        setError(null);
      } catch {
        if (!cancelled) {
          setError("Could not load draft pool");
          setStocks([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { stocks, loading, error };
}
