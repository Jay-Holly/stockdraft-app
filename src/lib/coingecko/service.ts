import {
  CRYPTO_COINGECKO_IDS,
  CRYPTO_SYMBOLS,
  type CryptoSymbol,
} from "@/lib/market/symbols";

type CoinGeckoPriceResponse = Record<
  string,
  { usd?: number; usd_24h_change?: number }
>;

export type CryptoQuote = {
  price: number;
  changePercent: number;
};

export type CryptoQuoteSource = "live" | "cache" | "fallback";

export type CryptoQuotesResult = {
  quotes: Record<CryptoSymbol, CryptoQuote>;
  source: CryptoQuoteSource;
  /** When these quotes were last fetched live from CoinGecko (null if never). */
  fetchedAt: number | null;
};

/** Minimum time between live CoinGecko API calls (shared across all server callers). */
export const CRYPTO_LIVE_CACHE_TTL_MS = 45_000;

/** After a 429, do not call CoinGecko again until this cooldown elapses. */
const RATE_LIMIT_COOLDOWN_MS = 60_000;

const FETCH_TIMEOUT_MS = 8_000;
const NETWORK_RETRY_DELAY_MS = 800;

/** Last-resort prices when CoinGecko is unreachable and no cache exists yet. */
const CRYPTO_STATIC_FALLBACK: Record<CryptoSymbol, CryptoQuote> = {
  BTC: { price: 97_000, changePercent: 0 },
  ETH: { price: 2_700, changePercent: 0 },
  SOL: { price: 140, changePercent: 0 },
  DOGE: { price: 0.17, changePercent: 0 },
};

let cachedLiveQuotes: {
  at: number;
  quotes: Record<CryptoSymbol, CryptoQuote>;
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

function hasUsableQuotes(
  quotes: Record<CryptoSymbol, CryptoQuote>
): boolean {
  return CRYPTO_SYMBOLS.some((symbol) => quotes[symbol].price > 0);
}

function parseCoinGeckoResponse(
  data: CoinGeckoPriceResponse
): Record<CryptoSymbol, CryptoQuote> {
  const quotes = {} as Record<CryptoSymbol, CryptoQuote>;

  for (const symbol of CRYPTO_SYMBOLS) {
    const id = CRYPTO_COINGECKO_IDS[symbol];
    const entry = data[id];
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
    quotes: CRYPTO_STATIC_FALLBACK,
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

async function fetchCryptoQuotesOnce(): Promise<
  | { ok: true; quotes: Record<CryptoSymbol, CryptoQuote> }
  | { ok: false; rateLimited: boolean }
> {
  const ids = Object.values(CRYPTO_COINGECKO_IDS).join(",");
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;

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
    const quotes = parseCoinGeckoResponse(data);
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

async function refreshCryptoQuotesFromApi(): Promise<CryptoQuotesResult> {
  const now = Date.now();

  if (now < rateLimitedUntil) {
    const cached = resultFromCache("cache");
    if (cached) return rememberResult(cached);
    return rememberResult(resultFromFallback());
  }

  const firstAttempt = await fetchCryptoQuotesOnce();

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
  const secondAttempt = await fetchCryptoQuotesOnce();

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

  console.warn("CoinGecko unavailable — using static crypto price fallback.");
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

/** Never throws — throttled live fetch, then cache, then static fallback. */
export async function fetchCryptoQuotes(): Promise<
  Record<CryptoSymbol, CryptoQuote>
> {
  const { quotes } = await fetchCryptoQuotesWithMeta();
  return quotes;
}
