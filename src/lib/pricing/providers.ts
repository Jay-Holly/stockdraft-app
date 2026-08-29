import "server-only";

import { fetchCryptoPool } from "@/lib/crypto-pool/server";
import {
  makePrice,
  unavailable,
  type Price,
  type PriceLookup,
} from "@/lib/pricing/types";

/**
 * The only code in the app that talks to a market data provider.
 *
 * The old system implemented Finnhub's quote endpoint twice (in the shared
 * service and again in the refresh cron) and CoinGecko's twice as well, each
 * copy carrying its own retry policy, batch size and pacing. A rate-limit fix
 * applied to one copy left the other one hammering the same key.
 *
 * There is one implementation per provider here, and one rate limiter that all
 * of them share.
 */

/* -------------------------------------------------------------------------- */
/* Rate limiting                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Finnhub's free tier allows 60 calls/minute. We pace to 50 to leave headroom
 * for the websocket and for calls made by other parts of the app during a run.
 *
 * Honest limitation: this limiter is module state, so on Vercel it is per
 * serverless instance. Two concurrent instances can each pace at 50/min and
 * collectively exceed the ceiling. The mitigation is not a cleverer limiter —
 * it is the store: every fetched price is written back immediately, so a
 * second instance reads the row instead of re-asking. Reducing the number of
 * calls that need making at all is the only thing that works across instances.
 */
const CALLS_PER_MINUTE = 50;
const MIN_CALL_SPACING_MS = Math.ceil(60_000 / CALLS_PER_MINUTE);

let nextCallAt = 0;

/** Blocks until this instance is allowed to make another provider call. */
async function takeRateLimitSlot(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, nextCallAt - now);
  nextCallAt = Math.max(now, nextCallAt) + MIN_CALL_SPACING_MS;
  if (wait > 0) await sleep(wait);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* -------------------------------------------------------------------------- */
/* Fetch helpers                                                              */
/* -------------------------------------------------------------------------- */

const REQUEST_TIMEOUT_MS = 8_000;

async function fetchJson(
  url: string,
  timeoutMs = REQUEST_TIMEOUT_MS,
  headers?: Record<string, string>
): Promise<{ ok: true; body: unknown } | { ok: false; status: number | null; detail: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers,
    });

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        detail: `HTTP ${response.status}`,
      };
    }

    return { ok: true, body: await response.json() };
  } catch (err) {
    return {
      ok: false,
      status: null,
      detail: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------------------------------------------------- */
/* Finnhub — equities                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Server-side calls prefer a server-only key.
 *
 * `NEXT_PUBLIC_FINNHUB_KEY` ships to the browser by definition, so anyone can
 * read it from devtools and spend the quota. The client websocket genuinely
 * needs a browser-visible token, but nothing server-side does — so this reads
 * a private key when one exists and only falls back to the public one so
 * behaviour doesn't change before that variable is set.
 */
function finnhubKey(): string | undefined {
  return process.env.FINNHUB_API_KEY ?? process.env.NEXT_PUBLIC_FINNHUB_KEY;
}

type FinnhubQuoteBody = {
  c?: number; // current price
  dp?: number; // percent change on the day
  t?: number; // unix seconds of the last trade
  o?: number; // today's open
  h?: number; // today's high
  l?: number; // today's low
};

/**
 * One equity quote.
 *
 * `asOf` comes from Finnhub's own last-trade timestamp, not from our clock.
 * That distinction matters: a symbol that stopped trading days ago still
 * returns a price, and stamping it with "now" is how a dead ticker's last
 * known value used to pass every freshness check in the system. Using the
 * provider's timestamp means a stale symbol fails the caller's freshness rule
 * on its own, with no special-case detection needed.
 */
export async function fetchFinnhubPrice(symbol: string): Promise<PriceLookup> {
  const upper = symbol.trim().toUpperCase();
  const token = finnhubKey();

  if (!token) {
    return unavailable(upper, "provider-error", `${upper}: no Finnhub key configured`);
  }

  await takeRateLimitSlot();

  const result = await fetchJson(
    `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(upper)}&token=${token}`
  );

  if (!result.ok) {
    const reason = result.status === 429 ? "rate-limited" : "provider-error";
    return unavailable(upper, reason, `${upper}: Finnhub ${result.detail}`);
  }

  const body = result.body as FinnhubQuoteBody;
  const current = Number(body?.c ?? 0);

  // Finnhub answers with c=0 for a symbol it cannot quote rather than erroring.
  // That zero is the single most expensive value in this system's history — it
  // is what got persisted as a $0 baseline and scored weeks as -100% wipeouts.
  // It stops here.
  if (!Number.isFinite(current) || current <= 0) {
    return unavailable(upper, "no-quote", `${upper}: Finnhub returned no price`);
  }

  const tradedAtSeconds = Number(body?.t ?? 0);
  const asOf =
    Number.isFinite(tradedAtSeconds) && tradedAtSeconds > 0
      ? new Date(tradedAtSeconds * 1000)
      : new Date();

  const price = makePrice({
    symbol: upper,
    price: current,
    changePercent: Number(body?.dp ?? 0),
    asOf,
    source: "finnhub",
  });

  return price
    ? { status: "ok" as const, ...price }
    : unavailable(upper, "no-quote", `${upper}: Finnhub price failed validation`);
}

/**
 * The full quote — price plus today's open/high/low, for the logger only.
 *
 * `fetchFinnhubPrice` above stays untouched: readers never needed anything
 * but the current price, and widening its return shape would have been a
 * change to every caller for no benefit to them. The logger is the one
 * caller that needs open/high/low, so it gets its own function rather than
 * everyone else paying for fields they don't use.
 *
 * The open is free on every call, not just the first one of the day — a
 * quote taken at 2 PM still reports the 9:30 open in `o`. That is what lets
 * the logger backfill a missed opening anchor on its very next sweep instead
 * of needing a dedicated, one-shot "opening sweep" that has no second chance
 * if it fails.
 */
export type FinnhubFullQuote = {
  symbol: string;
  price: number;
  changePercent: number;
  dayOpen: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  asOf: Date;
};

export async function fetchFinnhubFullQuote(
  symbol: string
): Promise<{ status: "ok"; quote: FinnhubFullQuote } | { status: "unavailable" } & Omit<
  ReturnType<typeof unavailable>,
  "status"
>> {
  const upper = symbol.trim().toUpperCase();
  const token = finnhubKey();

  if (!token) {
    return unavailable(upper, "provider-error", `${upper}: no Finnhub key configured`);
  }

  await takeRateLimitSlot();

  const result = await fetchJson(
    `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(upper)}&token=${token}`
  );

  if (!result.ok) {
    const reason = result.status === 429 ? "rate-limited" : "provider-error";
    return unavailable(upper, reason, `${upper}: Finnhub ${result.detail}`);
  }

  const body = result.body as FinnhubQuoteBody;
  const current = Number(body?.c ?? 0);

  // Same zero-is-not-a-price rule as fetchFinnhubPrice above.
  if (!Number.isFinite(current) || current <= 0) {
    return unavailable(upper, "no-quote", `${upper}: Finnhub returned no price`);
  }

  const tradedAtSeconds = Number(body?.t ?? 0);
  const asOf =
    Number.isFinite(tradedAtSeconds) && tradedAtSeconds > 0
      ? new Date(tradedAtSeconds * 1000)
      : new Date();

  const positiveOrNull = (n: unknown): number | null => {
    const v = Number(n);
    return Number.isFinite(v) && v > 0 ? v : null;
  };

  return {
    status: "ok",
    quote: {
      symbol: upper,
      price: current,
      changePercent: Number.isFinite(Number(body?.dp)) ? Number(body?.dp) : 0,
      dayOpen: positiveOrNull(body?.o),
      dayHigh: positiveOrNull(body?.h),
      dayLow: positiveOrNull(body?.l),
      asOf,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Alpaca — equities, primary                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Alpaca's free tier: 200 calls/minute. Paced to 180 for headroom. In
 * practice this ceiling is nearly irrelevant for the logger's own use — a
 * full-pool sweep is ONE call regardless of how many symbols it asks for
 * (verified against the live API 2026-08-29: all 502 real pool symbols,
 * one request, 351ms) — but it stays paced for defensiveness, e.g. the
 * admin page's single-symbol re-fetch button, which still costs a call.
 */
const ALPACA_CALLS_PER_MINUTE = 180;
const ALPACA_MIN_CALL_SPACING_MS = Math.ceil(60_000 / ALPACA_CALLS_PER_MINUTE);
let alpacaNextCallAt = 0;

async function takeAlpacaRateLimitSlot(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, alpacaNextCallAt - now);
  alpacaNextCallAt = Math.max(now, alpacaNextCallAt) + ALPACA_MIN_CALL_SPACING_MS;
  if (wait > 0) await sleep(wait);
}

function alpacaAuthHeaders(): { "APCA-API-KEY-ID": string; "APCA-API-SECRET-KEY": string } | null {
  const keyId = process.env.ALPACA_API_KEY_ID;
  const secret = process.env.ALPACA_API_SECRET_KEY;
  if (!keyId || !secret) return null;
  return { "APCA-API-KEY-ID": keyId, "APCA-API-SECRET-KEY": secret };
}

type AlpacaBar = { o?: number; h?: number; l?: number; c?: number; t?: string };
type AlpacaTrade = { p?: number; t?: string };
type AlpacaSnapshot = {
  dailyBar?: AlpacaBar;
  prevDailyBar?: AlpacaBar;
  latestTrade?: AlpacaTrade;
};
type AlpacaSnapshotsBody = Record<string, AlpacaSnapshot | undefined>;

/**
 * The same shape as `FinnhubFullQuote` deliberately — the logger treats a
 * result from either provider identically once parsed.
 */
export type AlpacaFullQuote = {
  symbol: string;
  price: number;
  changePercent: number;
  dayOpen: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  asOf: Date;
};

type AlpacaQuoteResult =
  | { status: "ok"; quote: AlpacaFullQuote }
  | ({ status: "unavailable" } & Omit<ReturnType<typeof unavailable>, "status">);

const positiveOrNull = (n: unknown): number | null => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : null;
};

/**
 * Every symbol requested, in ONE call — this is what makes Alpaca primary:
 * a full 500+ symbol sweep costs the same one request as a five-symbol one.
 *
 * Alpaca's own failure mode, confirmed against the live API rather than
 * assumed from docs: a symbol it cannot quote is not an error and not a
 * null entry — it is simply absent from the response object. Silently
 * iterating "whatever came back" would make that symbol vanish with no
 * record at all, which is worse than a wrong number because nothing would
 * ever flag it as missing. So every requested symbol is accounted for here
 * explicitly, present or not.
 */
export async function fetchAlpacaSnapshots(
  symbols: readonly string[]
): Promise<Map<string, AlpacaQuoteResult>> {
  const out = new Map<string, AlpacaQuoteResult>();
  const requested = [
    ...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean)),
  ];
  if (requested.length === 0) return out;

  const auth = alpacaAuthHeaders();
  if (!auth) {
    for (const symbol of requested) {
      out.set(symbol, unavailable(symbol, "provider-error", `${symbol}: no Alpaca key configured`));
    }
    return out;
  }

  await takeAlpacaRateLimitSlot();

  const result = await fetchJson(
    `https://data.alpaca.markets/v2/stocks/snapshots?symbols=${encodeURIComponent(requested.join(","))}`,
    15_000,
    auth
  );

  // Batch call failed as a whole (network error, auth failure, rate limit) —
  // every requested symbol is unavailable for the same reason, explicitly.
  if (!result.ok) {
    const reason = result.status === 429 ? "rate-limited" : "provider-error";
    for (const symbol of requested) {
      out.set(symbol, unavailable(symbol, reason, `${symbol}: Alpaca ${result.detail}`));
    }
    return out;
  }

  const body = result.body as AlpacaSnapshotsBody;

  for (const symbol of requested) {
    const snap = body?.[symbol];

    if (!snap) {
      out.set(symbol, unavailable(symbol, "no-quote", `${symbol}: absent from Alpaca's batch response`));
      continue;
    }

    const price = Number(snap.latestTrade?.p ?? snap.dailyBar?.c ?? 0);
    if (!Number.isFinite(price) || price <= 0) {
      out.set(symbol, unavailable(symbol, "no-quote", `${symbol}: Alpaca returned no usable trade price`));
      continue;
    }

    const prevClose = positiveOrNull(snap.prevDailyBar?.c);
    const changePercent = prevClose ? ((price - prevClose) / prevClose) * 100 : 0;

    const tradedAt = snap.latestTrade?.t ? new Date(snap.latestTrade.t) : null;
    const asOf = tradedAt && !Number.isNaN(tradedAt.getTime()) ? tradedAt : new Date();

    out.set(symbol, {
      status: "ok",
      quote: {
        symbol,
        price,
        changePercent,
        dayOpen: positiveOrNull(snap.dailyBar?.o),
        dayHigh: positiveOrNull(snap.dailyBar?.h),
        dayLow: positiveOrNull(snap.dailyBar?.l),
        asOf,
      },
    });
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* CoinGecko — crypto                                                         */
/* -------------------------------------------------------------------------- */

type CoinGeckoBody = Record<
  string,
  { usd?: number; usd_24h_change?: number; last_updated_at?: number } | undefined
>;

/**
 * Crypto quotes, fetched by CoinGecko id rather than ticker.
 *
 * Ticker symbols are ambiguous across chains — the pool's RAIN resolves to a
 * different token on other providers, at roughly half the price. The pool
 * defines each coin by its CoinGecko id precisely so that ambiguity has one
 * answer, and this function refuses to guess for a symbol the pool doesn't
 * define rather than falling back to a ticker lookup.
 *
 * CoinGecko takes every id in one request, so the whole pool costs one call.
 */
export async function fetchCoinGeckoPrices(
  symbols: readonly string[]
): Promise<Map<string, PriceLookup>> {
  const out = new Map<string, PriceLookup>();
  const wanted = [
    ...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean)),
  ];
  if (wanted.length === 0) return out;

  // fetchCryptoPool (not the sync getCachedCryptoPool accessor) — it loads
  // and caches on its own if nothing has warmed it yet in this process. The
  // logger is often the FIRST thing to run in a fresh serverless instance,
  // so it cannot assume some other route already populated the cache; that
  // assumption is exactly what turned "the cache happened to be empty" into
  // "every crypto symbol silently fails" the first time this ran cold.
  const pool = await fetchCryptoPool();
  const idBySymbol = new Map<string, string>();
  for (const coin of pool) {
    if (coin.coingeckoId) idBySymbol.set(coin.symbol.toUpperCase(), coin.coingeckoId);
  }

  const resolvable: string[] = [];
  for (const symbol of wanted) {
    if (idBySymbol.has(symbol)) {
      resolvable.push(symbol);
    } else {
      out.set(
        symbol,
        unavailable(
          symbol,
          "no-quote",
          `${symbol}: not defined in the crypto pool, refusing to guess an id`
        )
      );
    }
  }

  if (resolvable.length === 0) return out;

  const ids = resolvable.map((s) => idBySymbol.get(s)!);

  await takeRateLimitSlot();

  const result = await fetchJson(
    `https://api.coingecko.com/api/v3/simple/price` +
      `?ids=${encodeURIComponent([...new Set(ids)].join(","))}` +
      `&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true`
  );

  if (!result.ok) {
    const reason = result.status === 429 ? "rate-limited" : "provider-error";
    for (const symbol of resolvable) {
      out.set(
        symbol,
        unavailable(symbol, reason, `${symbol}: CoinGecko ${result.detail}`)
      );
    }
    return out;
  }

  const body = result.body as CoinGeckoBody;

  for (const symbol of resolvable) {
    const id = idBySymbol.get(symbol)!;
    const entry = body?.[id];
    const usd = Number(entry?.usd ?? 0);

    // A 200 response that simply omits a coin used to be filled in with
    // `price: 0` and reported as a success. Omission means "no answer", and
    // that is what it reports here.
    if (!Number.isFinite(usd) || usd <= 0) {
      out.set(
        symbol,
        unavailable(symbol, "no-quote", `${symbol}: CoinGecko returned no price for ${id}`)
      );
      continue;
    }

    const updatedAt = Number(entry?.last_updated_at ?? 0);
    const asOf =
      Number.isFinite(updatedAt) && updatedAt > 0
        ? new Date(updatedAt * 1000)
        : new Date();

    const price = makePrice({
      symbol,
      price: usd,
      changePercent: Number(entry?.usd_24h_change ?? 0),
      asOf,
      source: "coingecko",
    });

    out.set(
      symbol,
      price
        ? { status: "ok" as const, ...price }
        : unavailable(symbol, "no-quote", `${symbol}: CoinGecko price failed validation`)
    );
  }

  return out;
}

/**
 * Fetches many equities, pacing through the shared limiter and stopping at a
 * deadline.
 *
 * Symbols not reached before the deadline come back as `not-attempted`, which
 * is deliberately distinct from `no-quote`. The old code logged both as
 * "genuinely unavailable", so a run that simply ran out of time looked
 * identical to a set of delisted tickers — and the operator had no way to tell
 * that the fix was "give it more budget" rather than "these symbols are dead".
 */
export async function fetchFinnhubPrices(
  symbols: readonly string[],
  options: { deadline?: number } = {}
): Promise<Map<string, PriceLookup>> {
  const out = new Map<string, PriceLookup>();
  const unique = [
    ...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean)),
  ];

  const deadline = options.deadline ?? Number.POSITIVE_INFINITY;

  for (let i = 0; i < unique.length; i++) {
    const symbol = unique[i];

    if (Date.now() >= deadline) {
      for (let j = i; j < unique.length; j++) {
        out.set(
          unique[j],
          unavailable(
            unique[j],
            "not-attempted",
            `${unique[j]}: deadline reached before this symbol was requested`
          )
        );
      }
      break;
    }

    out.set(symbol, await fetchFinnhubPrice(symbol));
  }

  return out;
}

/** Narrow helper for callers that only want the successes. */
export function successesOf(
  lookups: Iterable<PriceLookup>
): Price[] {
  const prices: Price[] = [];
  for (const lookup of lookups) {
    if (lookup.status === "ok") prices.push(lookup);
  }
  return prices;
}
