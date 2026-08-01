import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
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

  // crypto_pool's RLS grants SELECT to `authenticated` only, so the
  // user-scoped client reads zero rows in every background context — cron
  // runs, week finalization, close capture. That emptied the pool, which
  // emptied getCryptoQuotesMap, which left every crypto quote missing, which
  // the old price fallback then papered over with the draft-day price. Since
  // shares = budget / price_at_pick, that produced a close of exactly the
  // book value ($100,000) every single week: crypto never compounded and ten
  // weeks of season gain read as one week's move. Read the pool with the
  // service client — it is a public reference table of coin names and ranks,
  // and fetchCachedCryptoQuotes already reads crypto_prices the same way.
  const supabase = (() => {
    try {
      return createServiceClient();
    } catch {
      return null;
    }
  })();

  const client = supabase ?? (await createClient());
  const { data, error } = await client
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
