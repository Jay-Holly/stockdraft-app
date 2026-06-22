import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { CryptoPoolCoin } from "@/lib/crypto-pool/types";
import { setCryptoPoolCache } from "@/lib/crypto-pool/symbols";

let cachedPool: CryptoPoolCoin[] | null = null;
let cachedAt = 0;
const POOL_CACHE_TTL_MS = 60_000;

function mapRow(row: {
  symbol: string;
  name: string;
  coingecko_id: string;
  market_cap_rank: number;
  reference_price_usd: number | null;
}): CryptoPoolCoin {
  return {
    symbol: row.symbol.toUpperCase(),
    name: row.name,
    coingeckoId: row.coingecko_id,
    marketCapRank: row.market_cap_rank,
    referencePriceUsd: row.reference_price_usd,
  };
}

export async function fetchCryptoPool(options?: {
  force?: boolean;
}): Promise<CryptoPoolCoin[]> {
  const now = Date.now();
  if (!options?.force && cachedPool && now - cachedAt < POOL_CACHE_TTL_MS) {
    return cachedPool;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crypto_pool")
    .select("symbol, name, coingecko_id, market_cap_rank, reference_price_usd")
    .order("market_cap_rank", { ascending: true });

  if (error || !data?.length) {
    return cachedPool ?? [];
  }

  const pool = data.map(mapRow);
  cachedPool = pool;
  cachedAt = now;
  setCryptoPoolCache(
    pool.map((coin) => ({
      symbol: coin.symbol,
      coingeckoId: coin.coingeckoId,
    }))
  );

  return pool;
}

export async function isCryptoPoolSymbolInDb(symbol: string): Promise<boolean> {
  const pool = await fetchCryptoPool();
  return pool.some((coin) => coin.symbol === symbol.toUpperCase());
}

export function getCachedCryptoPool(): CryptoPoolCoin[] {
  return cachedPool ?? [];
}
