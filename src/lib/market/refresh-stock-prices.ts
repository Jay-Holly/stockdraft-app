import "server-only";

import { fetchWithTimeout } from "@/lib/finnhub/service";
import { isUsMarketOpen } from "@/lib/market/hours";
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
/** ~240 symbols at 1.2s each fits Vercel's 300s function limit; full pool refreshes over ~2 runs. */
const MAX_SYMBOLS_PER_RUN = 240;

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

async function loadDraftPoolSymbols(): Promise<string[]> {
  const supabase = createServiceClient();
  const { data: poolRows, error: poolError } = await supabase
    .from("draft_pool")
    .select("symbol")
    .order("symbol");

  if (poolError || !poolRows?.length) return [];

  const symbols = poolRows.map((row) => row.symbol.toUpperCase());
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

async function fetchFinnhubQuote(
  symbol: string,
  token: string
): Promise<{ price: number; changePercent: number } | null> {
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

  if (!isUsMarketOpen()) {
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
  const now = new Date().toISOString();
  const rows: Array<{
    symbol: string;
    price: number;
    change_percent: number;
    updated_at: string;
  }> = [];

  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i]!;
    const quote = await fetchFinnhubQuote(symbol, token);

    if (quote) {
      rows.push({
        symbol,
        price: quote.price,
        change_percent: quote.changePercent,
        updated_at: now,
      });
      updated += 1;
    } else {
      failed += 1;
    }

    if (i + 1 < symbols.length) {
      await sleep(DELAY_BETWEEN_CALLS_MS);
    }
  }

  if (rows.length > 0) {
    const { error } = await supabase.from("stock_prices").upsert(rows, {
      onConflict: "symbol",
    });
    if (error) {
      throw error;
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
