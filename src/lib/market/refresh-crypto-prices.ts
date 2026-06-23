import "server-only";

import { createServiceClient } from "@/lib/supabase/service";

type CoinGeckoPriceResponse = Record<
  string,
  { usd?: number; usd_24h_change?: number }
>;

export type CryptoPriceRefreshResult = {
  skipped: boolean;
  reason?: string;
  symbolCount: number;
  updated: number;
  failed: number;
  durationMs: number;
};

const FETCH_TIMEOUT_MS = 8_000;
const COINGECKO_ID_CHUNK_SIZE = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadCryptoPoolRows(): Promise<
  Array<{ symbol: string; coingecko_id: string }>
> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("crypto_pool")
    .select("symbol, coingecko_id")
    .order("market_cap_rank", { ascending: true });

  if (error || !data?.length) return [];
  return data.map((row) => ({
    symbol: row.symbol.toUpperCase(),
    coingecko_id: row.coingecko_id,
  }));
}

async function fetchCoinGeckoChunk(
  ids: string[]
): Promise<CoinGeckoPriceResponse | null> {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd&include_24hr_change=true`;

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) return null;
    return (await response.json()) as CoinGeckoPriceResponse;
  } catch {
    return null;
  }
}

export async function refreshCryptoPricesFromCoingecko(): Promise<CryptoPriceRefreshResult> {
  const started = Date.now();
  const pool = await loadCryptoPoolRows();

  if (pool.length === 0) {
    return {
      skipped: true,
      reason: "crypto_pool is empty",
      symbolCount: 0,
      updated: 0,
      failed: 0,
      durationMs: Date.now() - started,
    };
  }

  const idToSymbol = new Map(
    pool.map((coin) => [coin.coingecko_id, coin.symbol])
  );
  const ids = [...new Set(pool.map((coin) => coin.coingecko_id))];
  const quotes = new Map<string, { price: number; changePercent: number }>();

  for (let i = 0; i < ids.length; i += COINGECKO_ID_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + COINGECKO_ID_CHUNK_SIZE);
    const data = await fetchCoinGeckoChunk(chunk);

    if (data) {
      for (const [id, entry] of Object.entries(data)) {
        const symbol = idToSymbol.get(id);
        if (!symbol) continue;
        const price = entry?.usd ?? 0;
        if (price <= 0) continue;
        quotes.set(symbol, {
          price,
          changePercent: entry?.usd_24h_change ?? 0,
        });
      }
    }

    if (i + COINGECKO_ID_CHUNK_SIZE < ids.length) {
      await sleep(300);
    }
  }

  if (quotes.size === 0) {
    return {
      skipped: true,
      reason: "CoinGecko returned no usable quotes",
      symbolCount: pool.length,
      updated: 0,
      failed: pool.length,
      durationMs: Date.now() - started,
    };
  }

  const supabase = createServiceClient();
  const now = new Date().toISOString();
  let updated = 0;
  let failed = 0;

  for (const coin of pool) {
    const quote = quotes.get(coin.symbol);
    if (!quote) {
      failed += 1;
      continue;
    }

    const { error } = await supabase.from("crypto_prices").upsert(
      {
        symbol: coin.symbol,
        price: quote.price,
        change_percent: quote.changePercent,
        updated_at: now,
      },
      { onConflict: "symbol" }
    );

    if (error) {
      failed += 1;
    } else {
      updated += 1;
    }
  }

  return {
    skipped: false,
    symbolCount: pool.length,
    updated,
    failed,
    durationMs: Date.now() - started,
  };
}
