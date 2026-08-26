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
/**
 * Equities only, deliberately.
 *
 * Guessing a crypto pair by appending "/USD" looks harmless and is not. On
 * 2026-08-12 our pool's RAIN (CoinGecko id `rain`, ~$0.0123) resolved on
 * Twelve Data's RAIN/USD to a different token entirely at ~$0.0054 — the same
 * ticker, another asset, no error. Backfilling from that would have written a
 * baseline 2.3x off and manufactured a +127% return nobody earned. HYPE isn't
 * carried at all (404). Crypto recovery belongs to CoinGecko, which prices
 * both coins correctly and is the source the pool's ids are defined against.
 */
export function isTwelveDataSupported(symbol: string): boolean {
  return !isCryptoSymbol(symbol.toUpperCase());
}

function fromTwelveDataSymbol(tdSymbol: string): string {
  return tdSymbol.toUpperCase();
}

function toNumber(value: unknown): number | null {
  const n = typeof value === "string" ? Number.parseFloat(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Why this reports *how* it failed rather than just returning null.
 *
 * A batch request that comes back empty has two very different causes, and
 * the caller has to tell them apart. One bad ticker in the batch is worth
 * retrying the other symbols individually; a spent credit budget is not —
 * retrying that just burns the retry on a request that cannot succeed, and
 * (worse) makes the next legitimate caller wait behind it.
 *
 * Twelve Data signals an exhausted budget two different ways: HTTP 429, and —
 * more often on the free tier — HTTP 200 carrying `{"code": 429, "status":
 * "error"}` in the body. Reading only the status line misses the second kind
 * and makes a quota failure look like a data failure.
 */
type TwelveDataResult =
  | { ok: true; data: unknown }
  | { ok: false; rateLimited: boolean; reason: string };

async function twelveDataFetch(path: string): Promise<TwelveDataResult> {
  const apiKey = process.env.TWELVE_DATA_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, rateLimited: false, reason: "no api key" };
  }

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
      return {
        ok: false,
        rateLimited: res.status === 429,
        reason: `HTTP ${res.status}`,
      };
    }

    const data = await res.json();

    // A 200 that is actually an error. Only treat it as one when there are no
    // `values` anywhere in the payload — a multi-symbol response legitimately
    // mixes good blocks with per-symbol error blocks, and throwing the whole
    // response away over one bad ticker is the poisoning this guards against.
    const code = (data as { code?: number })?.code;
    const status = (data as { status?: string })?.status;
    if (status === "error" && !hasAnyValues(data)) {
      const limited = code === 429;
      console.error(
        `[twelve-data] body error code=${code} for ${path}: ${
          (data as { message?: string })?.message ?? "(no message)"
        }`
      );
      return {
        ok: false,
        rateLimited: limited,
        reason: limited ? "credits exhausted" : `body code ${code}`,
      };
    }

    return { ok: true, data };
  } catch (err) {
    console.error(`[twelve-data] request failed for ${path}:`, err);
    return { ok: false, rateLimited: false, reason: String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/** True if the payload carries at least one series, at either nesting level. */
function hasAnyValues(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  if (Array.isArray((payload as TimeSeriesBlock).values)) return true;
  return Object.values(payload as Record<string, unknown>).some(
    (block) =>
      block &&
      typeof block === "object" &&
      Array.isArray((block as TimeSeriesBlock).values)
  );
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
 * Pulls an equity's real 09:30 open and final close for one trading date.
 *
 * The 09:30 ET bar is the session open; the last bar at or before 16:00 ET is
 * the close. This is what makes a missing open recoverable after the fact —
 * the true opening price is still sitting in the minute bars hours later.
 *
 * Crypto symbols are refused outright (see isTwelveDataSupported). Returns one
 * entry per requested symbol; a symbol Twelve Data can't answer for comes back
 * with nulls rather than being dropped, so callers can tell "no data" apart
 * from "not asked."
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

  const supported = unique.filter(isTwelveDataSupported);
  const refused = unique.filter((s) => !isTwelveDataSupported(s));
  if (refused.length > 0) {
    console.warn(
      `[twelve-data] not asking about crypto symbol(s): ${refused.join(", ")} — ticker collisions there resolve to the wrong asset`
    );
  }
  if (supported.length === 0) return result;

  // One request carries every symbol, but each symbol still costs its own
  // credit — callers are responsible for keeping the batch inside the
  // per-minute budget.
  const tdSymbols = supported.join(",");
  const params = new URLSearchParams({
    symbol: tdSymbols,
    interval: "1min",
    start_date: `${dateIso} 09:30:00`,
    end_date: `${dateIso} 16:00:00`,
    timezone: "America/New_York",
    outputsize: "400",
    order: "ASC",
  });

  const batched = await twelveDataFetch(`/time_series?${params.toString()}`);

  if (batched.ok) {
    absorbBlocks(batched.data, tdSymbols, result);
  } else if (batched.rateLimited) {
    // Nothing to salvage and nothing to retry: the budget is spent, so every
    // symbol here comes back null and the caller leaves them pending rather
    // than recording them as checked-and-missing.
    console.error(
      `[twelve-data] ${supported.length} symbol(s) unresolved for ${dateIso} — ${batched.reason}`
    );
    return result;
  }

  /**
   * One unanswerable ticker used to cost the other seven their prices.
   *
   * A multi-symbol request is all-or-nothing at the transport level: a symbol
   * Twelve Data cannot parse takes down the whole response, and every symbol
   * in that batch came back null despite being perfectly ordinary. Downstream
   * that reads as "eight symbols unrecoverable," the audit records all eight
   * as missing, and the contests they belong to freeze.
   *
   * Retrying the stragglers one at a time costs the same credit per symbol it
   * would have cost inside the batch — the batch is a round-trip optimisation,
   * not a billing one — so the only thing spent here is time. Skipped when the
   * budget is exhausted, since a retry then cannot succeed.
   */
  const stragglers = supported.filter((s) => !isUsableBar(result[s]));
  if (stragglers.length > 0) {
    for (const symbol of stragglers) {
      const single = new URLSearchParams({
        symbol,
        interval: "1min",
        start_date: `${dateIso} 09:30:00`,
        end_date: `${dateIso} 16:00:00`,
        timezone: "America/New_York",
        outputsize: "400",
        order: "ASC",
      });

      const one = await twelveDataFetch(`/time_series?${single.toString()}`);
      if (!one.ok) {
        if (one.rateLimited) {
          console.error(
            `[twelve-data] stopping per-symbol retries for ${dateIso} — ${one.reason}`
          );
          break;
        }
        continue;
      }
      absorbBlocks(one.data, symbol, result);
    }
  }

  return result;
}

/** A bar is only useful once it carries at least one real price. */
function isUsableBar(bar: DailyOpenClose | undefined): boolean {
  return Boolean(bar && (bar.open !== null || bar.close !== null));
}

/**
 * Folds a time_series payload into `result`, for either response shape: a
 * single-symbol request returns the block directly, a multi-symbol request
 * returns a map keyed by the Twelve Data symbol.
 */
function absorbBlocks(
  payload: unknown,
  requestedKey: string,
  result: Record<string, DailyOpenClose>
): void {
  if (!payload || typeof payload !== "object") return;

  const blocks: Array<[string, TimeSeriesBlock]> =
    "values" in (payload as TimeSeriesBlock)
      ? [[requestedKey, payload as TimeSeriesBlock]]
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
}
