import "server-only";

import { fetchWithTimeout } from "@/lib/finnhub/service";
import { isUsMarketRefreshAllowed } from "@/lib/market/hours";
import { isPricingFrozen } from "@/lib/market/pricing-freeze";
import { createServiceClient } from "@/lib/supabase/service";

type FinnhubQuoteResponse = {
  c: number;
  pc: number;
};

export type StockPriceRefreshResult = {
  skipped: boolean;
  reason?: string;
  symbolCount: number;
  updated: number;
  failed: number;
  durationMs: number;
};

/** Stay under Finnhub free tier (60 calls/min). */
const CALLS_PER_MINUTE = 50;
const DELAY_BETWEEN_CALLS_MS = Math.ceil(60_000 / CALLS_PER_MINUTE);
/**
 * Enough headroom to refresh the entire working set in a single run.
 *
 * This was 240, sized on the assumption that each symbol costs 1.2s serially
 * (~288s, right at Vercel's 300s limit). That reading missed GROUP_SIZE:
 * symbols are fetched five at a time concurrently, so the 1.2s spacing is per
 * GROUP, not per symbol. The real cost is ~58s for 240 and ~131s for 600 —
 * both well inside the limit, and the Finnhub call rate is unchanged at
 * 50/minute either way.
 *
 * The old cap meant a 547-symbol pool needed three runs to cover once, so at
 * a 30-minute cadence most symbols were 60-90 minutes stale at any moment.
 * That is what starved the lock's warm-price lookup and pushed hundreds of
 * symbols onto live Finnhub calls at lock time, which is what blew the
 * lifecycle past its own timeout. Covering the pool in one run is what makes
 * the warm cache actually usable.
 */
const MAX_SYMBOLS_PER_RUN = 600;
/**
 * Symbols within a group are fetched concurrently, so a group's wall-clock
 * cost is roughly one round-trip instead of GROUP_SIZE round-trips — the
 * 1.2s spacing still applies per group, not per symbol, so the aggregate
 * rate stays the same. This is what keeps a real run's actual duration close
 * to its theoretical cost (~131s for the full 600-symbol cap) instead of
 * drifting past Vercel's 300s limit on ordinary network latency.
 */
const GROUP_SIZE = 5;

function getFinnhubKey(): string | undefined {
  return process.env.NEXT_PUBLIC_FINNHUB_KEY;
}

function calcChangePercent(price: number, prevClose: number): number {
  if (!prevClose) return 0;
  return ((price - prevClose) / prevClose) * 100;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Everything that needs a current price: the draft pool, plus any symbol a
 * roster still holds.
 *
 * The held set matters because the pool changes. A stock dropped from the pool
 * while someone still owns it used to stop being refreshed entirely — its row
 * sat in stock_prices at whatever price it had on the way out, served with
 * full confidence forever. On 2026-08-13 that was FAC and SPCX, frozen since
 * 08-06 across four roster positions, with nothing to indicate the number was
 * eight days old. It costs a handful of extra symbols to close.
 */
async function loadDraftPoolSymbols(): Promise<string[]> {
  const supabase = createServiceClient();
  const [
    { data: poolRows, error: poolError },
    { data: heldRows },
    { data: coinRows },
  ] = await Promise.all([
    supabase.from("draft_pool").select("symbol").order("symbol"),
    supabase.from("draft_picks").select("symbol").gt("shares", 0),
    supabase.from("crypto_pool").select("symbol"),
  ]);

  if (poolError || !poolRows?.length) return [];

  // Held picks include coins, which are priced from crypto_prices on a
  // different cadence — sending them to Finnhub would just return zeros.
  const coins = new Set(
    (coinRows ?? []).map((row) => String(row.symbol).toUpperCase())
  );

  const symbols = [
    ...new Set([
      ...poolRows.map((row) => row.symbol.toUpperCase()),
      ...(heldRows ?? [])
        .map((row) => String(row.symbol).toUpperCase())
        .filter(
          (symbol) => symbol && symbol !== "__OPEN__" && !coins.has(symbol)
        ),
    ]),
  ];

  const { data: priceRows } = await supabase
    .from("stock_prices")
    .select("symbol, updated_at")
    .in("symbol", symbols);

  const updatedAtBySymbol = new Map(
    (priceRows ?? []).map((row) => [row.symbol.toUpperCase(), row.updated_at])
  );

  return symbols
    .sort((a, b) => {
      const aUpdated = updatedAtBySymbol.get(a);
      const bUpdated = updatedAtBySymbol.get(b);
      if (!aUpdated && !bUpdated) return a.localeCompare(b);
      if (!aUpdated) return -1;
      if (!bUpdated) return 1;
      return aUpdated.localeCompare(bUpdated);
    })
    .slice(0, MAX_SYMBOLS_PER_RUN);
}

export async function fetchFinnhubQuote(
  symbol: string,
  token: string
): Promise<{ price: number; changePercent: number } | null> {
  if (isPricingFrozen()) return null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetchWithTimeout(
        `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${token}`,
        { cache: "no-store", timeoutMs: 8000 }
      );

      if (!response.ok) {
        await sleep(250);
        continue;
      }

      const data = (await response.json()) as FinnhubQuoteResponse;
      const price = data.c ?? 0;
      const prevClose = data.pc ?? price;
      if (price <= 0) {
        await sleep(250);
        continue;
      }

      return {
        price,
        changePercent: calcChangePercent(price, prevClose),
      };
    } catch {
      await sleep(250);
    }
  }

  return null;
}

export async function refreshStockPricesFromFinnhub(): Promise<StockPriceRefreshResult> {
  const started = Date.now();

  if (isPricingFrozen()) {
    return {
      skipped: true,
      reason: "pricing frozen for the day",
      symbolCount: 0,
      updated: 0,
      failed: 0,
      durationMs: Date.now() - started,
    };
  }

  if (!isUsMarketRefreshAllowed()) {
    return {
      skipped: true,
      reason: "US market closed",
      symbolCount: 0,
      updated: 0,
      failed: 0,
      durationMs: Date.now() - started,
    };
  }

  const token = getFinnhubKey();
  if (!token) {
    return {
      skipped: true,
      reason: "Missing NEXT_PUBLIC_FINNHUB_KEY",
      symbolCount: 0,
      updated: 0,
      failed: 0,
      durationMs: Date.now() - started,
    };
  }

  const symbols = await loadDraftPoolSymbols();
  if (symbols.length === 0) {
    return {
      skipped: true,
      reason: "draft_pool is empty",
      symbolCount: 0,
      updated: 0,
      failed: 0,
      durationMs: Date.now() - started,
    };
  }

  const supabase = createServiceClient();
  let updated = 0;
  let failed = 0;

  // Written after every group, not once at the end — a run killed near
  // Vercel's 300s limit used to lose everything it had already fetched
  // because the only write was a single upsert after the full loop
  // finished. Persisting incrementally means a timeout only costs the
  // in-flight group, not the whole run.
  for (let i = 0; i < symbols.length; i += GROUP_SIZE) {
    const group = symbols.slice(i, i + GROUP_SIZE);
    const now = new Date().toISOString();

    const results = await Promise.all(
      group.map(async (symbol) => ({
        symbol,
        quote: await fetchFinnhubQuote(symbol, token),
      }))
    );

    const rows = results
      .filter((r): r is { symbol: string; quote: NonNullable<typeof r.quote> } =>
        r.quote !== null
      )
      .map(({ symbol, quote }) => ({
        symbol,
        price: quote.price,
        change_percent: quote.changePercent,
        updated_at: now,
      }));

    failed += results.length - rows.length;

    if (rows.length > 0) {
      const { error } = await supabase.from("stock_prices").upsert(rows, {
        onConflict: "symbol",
      });
      if (error) {
        throw error;
      }
      updated += rows.length;
    }

    if (i + GROUP_SIZE < symbols.length) {
      await sleep(DELAY_BETWEEN_CALLS_MS * group.length);
    }
  }

  return {
    skipped: false,
    symbolCount: symbols.length,
    updated,
    failed,
    durationMs: Date.now() - started,
  };
}
