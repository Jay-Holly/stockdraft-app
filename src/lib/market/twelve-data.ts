import "server-only";

import { isCryptoSymbol } from "@/lib/draft/engine";

/**
 * Twelve Data is the independent second source behind every DFS price.
 *
 * Two jobs, both after the fact:
 *  1. Recovery — a 9:30 open we failed to capture live is not lost. Twelve
 *     Data's 1-minute historical bars still hold that day's real 09:30 bar,
 *     so the audit can backfill the true value hours later. This is why a
 *     missing open never has to become a null baseline (scores the pick
 *     neutral) or, worse, yesterday's close (bakes the overnight gap into
 *     everyone who held that symbol).
 *  2. Verification — an independent read of the same open/close we already
 *     stored from Finnhub/CoinGecko, so a single source can't quietly decide
 *     a payout on its own bad tick.
 *
 * Free tier is 8 API credits/minute and 800/day, and each symbol in a request
 * costs its own credit. Callers must budget: see TWELVE_DATA_CREDITS_PER_MINUTE
 * and the batching in fetchDailyOpenClose.
 */

const BASE_URL = "https://api.twelvedata.com";
const TIMEOUT_MS = 10_000;

/** Free-tier ceiling. One symbol in one request = one credit. */
export const TWELVE_DATA_CREDITS_PER_MINUTE = 8;

export type DailyOpenClose = {
  symbol: string;
  /** The 09:30 ET bar's open — the real session open, not a prior close. */
  open: number | null;
  /** The final bar's close for that session. */
  close: number | null;
};

export function hasTwelveDataKey(): boolean {
  return Boolean(process.env.TWELVE_DATA_API_KEY?.trim());
}

/**
 * Twelve Data quotes crypto as a pair ("BTC/USD"); equities are the plain
 * ticker. Everything else about the request is identical.
 */
export function toTwelveDataSymbol(symbol: string): string {
  const upper = symbol.toUpperCase();
  return isCryptoSymbol(upper) ? `${upper}/USD` : upper;
}

function fromTwelveDataSymbol(tdSymbol: string): string {
  return tdSymbol.toUpperCase().replace(/\/USD$/, "");
}

function toNumber(value: unknown): number | null {
  const n = typeof value === "string" ? Number.parseFloat(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

async function twelveDataFetch(path: string): Promise<unknown | null> {
  const apiKey = process.env.TWELVE_DATA_API_KEY?.trim();
  if (!apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const separator = path.includes("?") ? "&" : "?";
    const res = await fetch(`${BASE_URL}${path}${separator}apikey=${apiKey}`, {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      console.error(`[twelve-data] HTTP ${res.status} for ${path}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error(`[twelve-data] request failed for ${path}:`, err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

type TimeSeriesValue = {
  datetime?: string;
  open?: string | number;
  close?: string | number;
};

type TimeSeriesBlock = {
  status?: string;
  values?: TimeSeriesValue[];
  meta?: { symbol?: string };
};

/**
 * Pulls the session's real 09:30 open and final close for one trading date.
 *
 * Equities: the 09:30 ET bar is the session open; the last bar at or before
 * 16:00 ET is the close. Crypto trades 24/7, so "the session" is defined the
 * same way the contests define it — 09:30 to 16:00 ET on the contest date —
 * which keeps a crypto pick measured over the same window as a stock pick in
 * the same lineup.
 *
 * Returns one entry per requested symbol; a symbol Twelve Data can't answer
 * for comes back with nulls rather than being dropped, so callers can tell
 * "no data" apart from "not asked."
 */
export async function fetchDailyOpenClose(
  symbols: readonly string[],
  dateIso: string
): Promise<Record<string, DailyOpenClose>> {
  const unique = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))];
  const result: Record<string, DailyOpenClose> = {};
  for (const symbol of unique) {
    result[symbol] = { symbol, open: null, close: null };
  }
  if (unique.length === 0 || !hasTwelveDataKey()) return result;

  // One request carries every symbol, but each symbol still costs its own
  // credit — callers are responsible for keeping the batch inside the
  // per-minute budget.
  const tdSymbols = unique.map(toTwelveDataSymbol).join(",");
  const params = new URLSearchParams({
    symbol: tdSymbols,
    interval: "1min",
    start_date: `${dateIso} 09:30:00`,
    end_date: `${dateIso} 16:00:00`,
    timezone: "America/New_York",
    outputsize: "400",
    order: "ASC",
  });

  const payload = await twelveDataFetch(`/time_series?${params.toString()}`);
  if (!payload || typeof payload !== "object") return result;

  // A single-symbol request returns the block directly; a multi-symbol
  // request returns a map keyed by the Twelve Data symbol.
  const blocks: Array<[string, TimeSeriesBlock]> =
    "values" in (payload as TimeSeriesBlock)
      ? [[tdSymbols, payload as TimeSeriesBlock]]
      : Object.entries(payload as Record<string, TimeSeriesBlock>);

  for (const [key, block] of blocks) {
    if (!block || typeof block !== "object") continue;
    const values = Array.isArray(block.values) ? block.values : [];
    if (values.length === 0) continue;

    const symbol = fromTwelveDataSymbol(block.meta?.symbol ?? key);
    if (!(symbol in result)) continue;

    result[symbol] = {
      symbol,
      open: toNumber(values[0].open),
      close: toNumber(values[values.length - 1].close),
    };
  }

  return result;
}
