"use client";

import { useEffect, useState } from "react";
import type { CryptoPoolCoin } from "@/lib/crypto-pool/types";
import { setCryptoPoolCache } from "@/lib/crypto-pool/symbols";

export function useCryptoPool() {
  const [coins, setCoins] = useState<CryptoPoolCoin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/draft/crypto-pool");
        const data = await res.json();

        if (cancelled) return;

        if (!res.ok) {
          setError(data.error ?? "Could not load crypto pool");
          setCoins([]);
          return;
        }

        const loaded = (data.coins ?? []) as CryptoPoolCoin[];
        setCoins(loaded);
        setCryptoPoolCache(
          loaded.map((coin) => ({
            symbol: coin.symbol,
            coingeckoId: coin.coingeckoId,
          }))
        );
        setError(null);
      } catch {
        if (!cancelled) {
          setError("Could not load crypto pool");
          setCoins([]);
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

  return { coins, loading, error };
}
