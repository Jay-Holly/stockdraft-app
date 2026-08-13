import "server-only";

import { createServiceClient } from "@/lib/supabase/service";

/**
 * The independent second opinion on crypto, using stored coin ids rather than
 * tickers.
 *
 * CoinGecko decides every crypto price we score and nothing used to check it.
 * Asking another provider for the same ticker is not a check — RAIN, MNT and U
 * each resolve elsewhere to a different asset, off by 2.3x, ~1600x and ~9x.
 * So each coin carries a coinpaprika_id resolved once by price agreement
 * (migration 087, scripts/map-coinpaprika-ids.mjs), and this only ever looks up
 * that stored id.
 *
 * Two limits of the free tier shape what it can prove, and both are reported
 * honestly rather than papered over:
 *
 *  - Hourly granularity. The 16:00 ET close lands exactly on an hourly point,
 *    so a close is verified precisely. The 09:30 ET open falls between two,
 *    so an open is only bracketed by the prices either side of it. That still
 *    catches every failure that has actually cost anything here — a wrong
 *    asset, a corrupted baseline, an 8% drift — but not a 1-2% wobble.
 *
 *  - About 24 hours of history. Same-evening auditing works, which is when the
 *    audit runs; re-auditing an older date does not, and comes back empty
 *    rather than wrong.
 */

const TIMEOUT_MS = 10_000;
const MARKET_OPEN_HOUR_ET = 9;
const MARKET_CLOSE_HOUR_ET = 16;

export type CryptoSessionCheck = {
  symbol: string;
  /** Prices bracketing the 09:30 ET open (the 09:00 and 10:00 ET points). */
  openBracket: [number, number] | null;
  /** Price exactly at the 16:00 ET close. */
  close: number | null;
};

/** Eastern offset from UTC on a given date, as a negative number (-4 / -5). */
function easternOffsetHours(dateIso: string): number {
  const probe = new Date(`${dateIso}T12:00:00Z`);
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "shortOffset",
  })
    .formatToParts(probe)
    .find((p) => p.type === "timeZoneName")?.value;

  const parsed = Number.parseInt((label ?? "GMT-5").replace("GMT", ""), 10);
  return Number.isFinite(parsed) ? parsed : -5;
}

function utcHourFor(etHour: number, dateIso: string): number {
  return etHour - easternOffsetHours(dateIso);
}

async function fetchHourly(
  coinpaprikaId: string,
  dateIso: string
): Promise<Map<number, number> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const openUtc = utcHourFor(MARKET_OPEN_HOUR_ET, dateIso);
    const closeUtc = utcHourFor(MARKET_CLOSE_HOUR_ET, dateIso);
    const start = `${dateIso}T${String(openUtc).padStart(2, "0")}:00:00Z`;
    const end = `${dateIso}T${String(closeUtc + 1).padStart(2, "0")}:00:00Z`;

    const url = `https://api.coinpaprika.com/v1/tickers/${encodeURIComponent(coinpaprikaId)}/historical?start=${start}&end=${end}&interval=1h`;
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) {
      // 402 here means the date has aged out of the free window — expected for
      // anything but a same-day audit, and not an error worth shouting about.
      if (res.status !== 402) {
        console.warn(`[coinpaprika] HTTP ${res.status} for ${coinpaprikaId}`);
      }
      return null;
    }

    const rows = (await res.json()) as Array<{
      timestamp?: string;
      price?: number;
    }>;
    if (!Array.isArray(rows) || rows.length === 0) return null;

    const byHour = new Map<number, number>();
    for (const row of rows) {
      if (!row.timestamp || typeof row.price !== "number") continue;
      byHour.set(new Date(row.timestamp).getUTCHours(), row.price);
    }
    return byHour;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Looks up the session's bracketing open prices and exact close for each
 * symbol, via its stored coin id. A symbol with no stored mapping, or one the
 * free window no longer covers, comes back with nulls — "we could not check
 * this" rather than a number that might be another asset entirely.
 */
export async function fetchCryptoSessionChecks(
  symbols: readonly string[],
  dateIso: string
): Promise<Record<string, CryptoSessionCheck>> {
  const result: Record<string, CryptoSessionCheck> = {};
  const unique = [...new Set(symbols.map((s) => s.toUpperCase()))];
  for (const symbol of unique) {
    result[symbol] = { symbol, openBracket: null, close: null };
  }
  if (unique.length === 0) return result;

  const supabase = createServiceClient();
  const { data: pool } = await supabase
    .from("crypto_pool")
    .select("symbol, coinpaprika_id")
    .in("symbol", unique);

  const openUtc = utcHourFor(MARKET_OPEN_HOUR_ET, dateIso);
  const closeUtc = utcHourFor(MARKET_CLOSE_HOUR_ET, dateIso);

  for (const row of pool ?? []) {
    const symbol = String(row.symbol).toUpperCase();
    const id = row.coinpaprika_id;
    if (!id) {
      console.warn(
        `[coinpaprika] ${symbol} has no stored coin id — leaving it unverified rather than guessing by ticker`
      );
      continue;
    }

    const byHour = await fetchHourly(id, dateIso);
    if (!byHour) continue;

    const before = byHour.get(openUtc);
    const after = byHour.get(openUtc + 1);
    const close = byHour.get(closeUtc);

    result[symbol] = {
      symbol,
      openBracket:
        typeof before === "number" && typeof after === "number"
          ? [Math.min(before, after), Math.max(before, after)]
          : null,
      close: typeof close === "number" ? close : null,
    };
  }

  return result;
}
