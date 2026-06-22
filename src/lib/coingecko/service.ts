import "server-only";

import { CRYPTO_LIVE_CACHE_TTL_MS } from "@/lib/coingecko/constants";
import type {
  CryptoQuote,
  CryptoQuoteSource,
  CryptoQuotesResult,
} from "@/lib/coingecko/types";
import { fetchCryptoPool, getCachedCryptoPool } from "@/lib/crypto-pool/server";
import {
  getCoingeckoIdMap,
  getCryptoSymbols,
} from "@/lib/crypto-pool/symbols";

export type { CryptoQuote, CryptoQuoteSource, CryptoQuotesResult } from "@/lib/coingecko/types";

type CoinGeckoPriceResponse = Record<
  string,
  { usd?: number; usd_24h_change?: number }
>;

const RATE_LIMIT_COOLDOWN_MS = 60_000;
const FETCH_TIMEOUT_MS = 8_000;
const NETWORK_RETRY_DELAY_MS = 800;
const COINGECKO_ID_CHUNK_SIZE = 100;

const LEGACY_STATIC_FALLBACK: Record<string, CryptoQuote> = {
  BTC: { price: 97_000, changePercent: 0 },
  ETH: { price: 2_700, changePercent: 0 },
  SOL: { price: 140, changePercent: 0 },
  DOGE: { price: 0.17, changePercent: 0 },
};

let cachedLiveQuotes: {
  at: number;
  quotes: Record<string, CryptoQuote>;
} | null = null;

let lastResultMeta: {
  source: CryptoQuoteSource;
  fetchedAt: number | null;
} = { source: "fallback", fetchedAt: null };

let rateLimitedUntil = 0;
let inFlightRefresh: Promise<CryptoQuotesResult> | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensurePoolLoaded(): Promise<Record<string, string>> {
  const pool = await fetchCryptoPool();
  if (pool.length === 0) {
    return getCoingeckoIdMap();
  }
  return getCoingeckoIdMap();
}

function referenceQuotesFromPool(): Record<string, CryptoQuote> {
  const quotes: Record<string, CryptoQuote> = {};
  for (const coin of getCachedCryptoPool()) {
    if (coin.referencePriceUsd != null && coin.referencePriceUsd > 0) {
      quotes[coin.symbol] = {
        price: coin.referencePriceUsd,
        changePercent: 0,
      };
    }
  }
  return quotes;
}

function staticFallbackQuotes(): Record<string, CryptoQuote> {
  const idMap = getCoingeckoIdMap();
  const symbols = Object.keys(idMap);
  const fromDb = referenceQuotesFromPool();
  const quotes: Record<string, CryptoQuote> = {};

  for (const symbol of symbols.length > 0
    ? symbols
    : Object.keys(LEGACY_STATIC_FALLBACK)) {
    quotes[symbol] =
      fromDb[symbol] ??
      LEGACY_STATIC_FALLBACK[symbol] ??
      { price: 0, changePercent: 0 };
  }

  return quotes;
}

function hasUsableQuotes(quotes: Record<string, CryptoQuote>): boolean {
  return Object.values(quotes).some((quote) => quote.price > 0);
}

function parseCoinGeckoResponse(
  data: CoinGeckoPriceResponse,
  idToSymbol: Map<string, string>
): Record<string, CryptoQuote> {
  const quotes: Record<string, CryptoQuote> = {};

  for (const [id, entry] of Object.entries(data)) {
    const symbol = idToSymbol.get(id);
    if (!symbol) continue;
    quotes[symbol] = {
      price: entry?.usd ?? 0,
      changePercent: entry?.usd_24h_change ?? 0,
    };
  }

  return quotes;
}

function resultFromCache(
  source: Extract<CryptoQuoteSource, "live" | "cache">
): CryptoQuotesResult | null {
  if (!cachedLiveQuotes) return null;
  return {
    quotes: cachedLiveQuotes.quotes,
    source,
    fetchedAt: cachedLiveQuotes.at,
  };
}

function resultFromFallback(): CryptoQuotesResult {
  return {
    quotes: staticFallbackQuotes(),
    source: "fallback",
    fetchedAt: null,
  };
}

function rememberResult(result: CryptoQuotesResult): CryptoQuotesResult {
  lastResultMeta = {
    source: result.source,
    fetchedAt: result.fetchedAt,
  };
  return result;
}

export function getLastCryptoQuoteSource(): CryptoQuoteSource {
  return lastResultMeta.source;
}

async function fetchCryptoQuotesChunk(
  ids: string[],
  idToSymbol: Map<string, string>
): Promise<
  | { ok: true; quotes: Record<string, CryptoQuote> }
  | { ok: false; rateLimited: boolean }
> {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd&include_24hr_change=true`;

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (response.status === 429) {
      return { ok: false, rateLimited: true };
    }

    if (!response.ok) {
      console.warn(
        `CoinGecko price fetch failed: HTTP ${response.status} ${response.statusText}`
      );
      return { ok: false, rateLimited: false };
    }

    const data = (await response.json()) as CoinGeckoPriceResponse;
    const quotes = parseCoinGeckoResponse(data, idToSymbol);
    if (!hasUsableQuotes(quotes)) {
      return { ok: false, rateLimited: false };
    }

    return { ok: true, quotes };
  } catch (error) {
    console.warn(
      "CoinGecko price fetch failed:",
      error instanceof Error ? error.message : error
    );
    return { ok: false, rateLimited: false };
  }
}

async function fetchAllCryptoQuotesOnce(
  idMap: Record<string, string>
): Promise<
  | { ok: true; quotes: Record<string, CryptoQuote> }
  | { ok: false; rateLimited: boolean }
> {
  const idToSymbol = new Map(
    Object.entries(idMap).map(([symbol, id]) => [id, symbol])
  );
  const ids = [...new Set(Object.values(idMap))];
  const merged: Record<string, CryptoQuote> = {};
  let sawRateLimit = false;

  for (let i = 0; i < ids.length; i += COINGECKO_ID_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + COINGECKO_ID_CHUNK_SIZE);
    const result = await fetchCryptoQuotesChunk(chunk, idToSymbol);

    if (result.ok) {
      Object.assign(merged, result.quotes);
      if (i + COINGECKO_ID_CHUNK_SIZE < ids.length) {
        await sleep(300);
      }
      continue;
    }

    if (result.rateLimited) sawRateLimit = true;
  }

  if (hasUsableQuotes(merged)) {
    for (const symbol of Object.keys(idMap)) {
      if (!merged[symbol]) {
        merged[symbol] = { price: 0, changePercent: 0 };
      }
    }
    return { ok: true, quotes: merged };
  }

  return { ok: false, rateLimited: sawRateLimit };
}

async function refreshCryptoQuotesFromApi(): Promise<CryptoQuotesResult> {
  const now = Date.now();

  if (now < rateLimitedUntil) {
    const cached = resultFromCache("cache");
    if (cached) return rememberResult(cached);
    return rememberResult(resultFromFallback());
  }

  const idMap = await ensurePoolLoaded();
  const firstAttempt = await fetchAllCryptoQuotesOnce(idMap);

  if (firstAttempt.ok) {
    const at = Date.now();
    cachedLiveQuotes = { at, quotes: firstAttempt.quotes };
    return rememberResult({
      quotes: firstAttempt.quotes,
      source: "live",
      fetchedAt: at,
    });
  }

  if (firstAttempt.rateLimited) {
    rateLimitedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
    console.warn(
      `CoinGecko rate limited (429) — using cached crypto prices for ${RATE_LIMIT_COOLDOWN_MS / 1000}s`
    );
    const cached = resultFromCache("cache");
    if (cached) return rememberResult(cached);
    return rememberResult(resultFromFallback());
  }

  await sleep(NETWORK_RETRY_DELAY_MS);
  const secondAttempt = await fetchAllCryptoQuotesOnce(idMap);

  if (secondAttempt.ok) {
    const at = Date.now();
    cachedLiveQuotes = { at, quotes: secondAttempt.quotes };
    return rememberResult({
      quotes: secondAttempt.quotes,
      source: "live",
      fetchedAt: at,
    });
  }

  if (secondAttempt.rateLimited) {
    rateLimitedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
    console.warn(
      `CoinGecko rate limited (429) — using cached crypto prices for ${RATE_LIMIT_COOLDOWN_MS / 1000}s`
    );
  }

  const cached = resultFromCache("cache");
  if (cached) {
    console.warn("CoinGecko unavailable — using last-known crypto prices.");
    return rememberResult(cached);
  }

  console.warn("CoinGecko unavailable — using crypto pool reference prices.");
  return rememberResult(resultFromFallback());
}

export async function fetchCryptoQuotesWithMeta(): Promise<CryptoQuotesResult> {
  const now = Date.now();

  if (cachedLiveQuotes && now - cachedLiveQuotes.at < CRYPTO_LIVE_CACHE_TTL_MS) {
    return rememberResult({
      quotes: cachedLiveQuotes.quotes,
      source: "live",
      fetchedAt: cachedLiveQuotes.at,
    });
  }

  if (!inFlightRefresh) {
    inFlightRefresh = refreshCryptoQuotesFromApi().finally(() => {
      inFlightRefresh = null;
    });
  }

  return inFlightRefresh;
}

/** Never throws — throttled live fetch, then cache, then DB reference / static fallback. */
export async function fetchCryptoQuotes(): Promise<Record<string, CryptoQuote>> {
  const { quotes } = await fetchCryptoQuotesWithMeta();
  return quotes;
}

/** Warm the in-memory symbol cache from Supabase (no price fetch). */
export async function warmCryptoPoolCache(): Promise<string[]> {
  await fetchCryptoPool();
  return getCryptoSymbols();
}

