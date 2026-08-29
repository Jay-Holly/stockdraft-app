import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import type { AssetClass } from "@/lib/pricing/store";

/**
 * The read side of the price log (migration 089).
 *
 * `log-store.ts` is how prices get INTO the log. This is the only sanctioned
 * way they come back out for scoring. The split matters: the logger is the
 * one caller allowed to talk to a provider, and everything downstream — every
 * league, every contest, every standings page — reads what the logger already
 * wrote down. That is what "readers never call a provider" means in practice.
 *
 * ONE RULE GOVERNS THIS ENTIRE FILE, and it is the rule the whole rebuild
 * exists to enforce:
 *
 *   A missing price is returned as a MISS. It is never returned as a number.
 *
 * Not zero, not the last known price, not the draft-day price, not `null`
 * silently coerced into 0 three call sites later. Every historical incident in
 * this system has the same shape — a failed lookup became a plausible number,
 * and the plausible number got scored, paid out, and written to history as if
 * it were real. So the return type here makes "I don't have it" impossible to
 * ignore: callers get hits and misses in separate collections, and there is no
 * shape in which a miss can be mistaken for a price.
 */

/** A price the log actually holds. `price > 0` is a database constraint. */
export type PriceHit = {
  symbol: string;
  assetClass: AssetClass;
  price: number;
  /** The provider's own day change, when it supplied one. Not recomputed. */
  changePercent: number | null;
  /** When the price was true at its source — not when we read it. */
  asOf: Date;
  capturedAt: Date;
  source: string;
  /** Present only when the provider supplied them. Diamond Hands needs these. */
  dayHigh: number | null;
  dayLow: number | null;
  /** True when an admin hand-corrected this anchor. Shown in the audit view. */
  isManual: boolean;
};

/**
 * Why a symbol has no usable price. Distinct reasons because they call for
 * different responses: `logged-failure` means the logger tried and the
 * provider refused (retryable, and already recorded); `no-observation` means
 * nothing ever tried, which is a scheduling problem, not a provider problem.
 */
export type PriceMissReason =
  | "no-observation"
  | "logged-failure"
  | "not-requested";

export type PriceMiss = {
  symbol: string;
  reason: PriceMissReason;
  /** The logger's own failure_reason, when there was a logged attempt. */
  detail: string | null;
};

/**
 * The result of any lookup in this file.
 *
 * Deliberately NOT a `Map<string, number>` with absent keys meaning failure.
 * That shape is what let `prices.get(sym) ?? 0` spread through the old code —
 * one `?? 0` and a refusal becomes a $0 price, which scores as -100%.
 */
export type PriceLookup = {
  hits: Map<string, PriceHit>;
  misses: Map<string, PriceMiss>;
  /** Convenience for the common guard: did we get everything we asked for? */
  complete: boolean;
};

type PriceLogRow = {
  symbol: string;
  asset_class: string;
  price: string | number | null;
  failure_reason: string | null;
  change_percent: string | number | null;
  day_high: string | number | null;
  day_low: string | number | null;
  as_of: string | null;
  captured_at: string;
  source: string;
  set_by: string | null;
};

/**
 * PostgREST caps a response at 1000 rows and a URL at a finite length, and
 * this system reads 552 symbols at a time. Both limits have silently truncated
 * results here before — a truncated read looks exactly like "those symbols
 * have no price," which is the precise lie this file exists to prevent. So
 * requests are chunked well under both bounds and results are concatenated.
 */
const SYMBOL_CHUNK = 150;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function toNumberOrNull(value: string | number | null): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function rowToHit(row: PriceLogRow): PriceHit | null {
  const price = toNumberOrNull(row.price);
  // A row with a non-positive price cannot exist (089 constraint), and a
  // priced row always carries as_of (089 constraint). If either is somehow
  // untrue, the row is not trustworthy enough to score — treat it as absent
  // rather than repairing it into something usable.
  if (price == null || price <= 0) return null;
  if (row.as_of == null) return null;

  return {
    symbol: row.symbol.toUpperCase(),
    assetClass: row.asset_class === "crypto" ? "crypto" : "stock",
    price,
    changePercent: toNumberOrNull(row.change_percent),
    asOf: new Date(row.as_of),
    capturedAt: new Date(row.captured_at),
    source: row.source,
    dayHigh: toNumberOrNull(row.day_high),
    dayLow: toNumberOrNull(row.day_low),
    isManual: row.source === "manual" || row.set_by != null,
  };
}

function emptyLookup(): PriceLookup {
  return { hits: new Map(), misses: new Map(), complete: true };
}

/**
 * The anchor price for each symbol on a given session date.
 *
 * Anchors ('open' / 'close') are what contests score against — a sample is the
 * live price during the day and is never an anchor. Superseded rows are
 * excluded, so an admin correction wins over what the provider originally
 * said while the original stays in the table forever.
 */
export async function getAnchors(
  symbols: readonly string[],
  sessionDate: string,
  kind: "open" | "close"
): Promise<PriceLookup> {
  const wanted = [...new Set(symbols.map((s) => s.toUpperCase()))].filter(Boolean);
  if (wanted.length === 0) return emptyLookup();

  const supabase = createServiceClient();
  const hits = new Map<string, PriceHit>();
  const failures = new Map<string, string | null>();

  for (const group of chunk(wanted, SYMBOL_CHUNK)) {
    const { data, error } = await supabase
      .from("price_log")
      .select(
        "symbol, asset_class, price, failure_reason, change_percent, day_high, day_low, as_of, captured_at, source, set_by"
      )
      .in("symbol", group)
      .eq("session_date", sessionDate)
      .eq("kind", kind)
      .is("superseded_at", null)
      .order("captured_at", { ascending: false });

    if (error) {
      // A failed read is NOT "these symbols have no price." Saying so would
      // hand the caller a confident, wrong answer built out of a database
      // outage — exactly the laundering this module exists to stop.
      throw new Error(
        `[price-read] anchor read failed (${kind} ${sessionDate}, ${group.length} symbols): ${error.message}`
      );
    }

    for (const row of (data ?? []) as PriceLogRow[]) {
      const symbol = row.symbol.toUpperCase();
      const hit = rowToHit(row);
      if (hit) {
        // Ordered newest-first, so the first priced row wins.
        if (!hits.has(symbol)) hits.set(symbol, hit);
      } else if (row.failure_reason != null && !failures.has(symbol)) {
        failures.set(symbol, row.failure_reason);
      }
    }
  }

  const misses = new Map<string, PriceMiss>();
  for (const symbol of wanted) {
    if (hits.has(symbol)) continue;
    misses.set(symbol, {
      symbol,
      reason: failures.has(symbol) ? "logged-failure" : "no-observation",
      detail: failures.get(symbol) ?? null,
    });
  }

  return { hits, misses, complete: misses.size === 0 };
}

/** Single-symbol anchor. Returns the hit, or null — never a substitute price. */
export async function getAnchor(
  symbol: string,
  sessionDate: string,
  kind: "open" | "close"
): Promise<PriceHit | null> {
  const lookup = await getAnchors([symbol], sessionDate, kind);
  return lookup.hits.get(symbol.toUpperCase()) ?? null;
}

/**
 * The most recent observation for each symbol, of any kind.
 *
 * This is for LIVE views — in-progress standings, a team page mid-week. It is
 * explicitly not for settling anything: a live standings number that is a few
 * minutes stale is fine, and a final score built on "whatever we happened to
 * have" is how a contest gets scored against a Tuesday price. Settle from
 * `getAnchors`, always.
 */
export async function getLatestPrices(
  symbols: readonly string[]
): Promise<PriceLookup> {
  const wanted = [...new Set(symbols.map((s) => s.toUpperCase()))].filter(Boolean);
  if (wanted.length === 0) return emptyLookup();

  const supabase = createServiceClient();
  const hits = new Map<string, PriceHit>();

  for (const group of chunk(wanted, SYMBOL_CHUNK)) {
    // The most recent row that actually HAS a price — not simply the most
    // recent row.
    //
    // This distinction became load-bearing when the logger moved to
    // write-on-change: prices are now written only when they move, but a
    // failure is written every time it happens. Reading "newest row per
    // symbol" would therefore let a single transient provider error erase a
    // symbol's price everywhere in the app, one minute after a perfectly good
    // price was recorded. The good price is still in the table; the read was
    // just asking the wrong question.
    //
    // Falling back to the last known price is right for LIVE display and
    // wrong for settlement — which is why settlement does not come through
    // here at all. It uses getAnchors, where the anchor either exists for
    // that session or the contest holds.
    const { data, error } = await supabase
      .from("price_log")
      .select(
        "symbol, asset_class, price, failure_reason, change_percent, day_high, day_low, as_of, captured_at, source, set_by"
      )
      .in("symbol", group)
      .not("price", "is", null)
      .is("superseded_at", null)
      .order("captured_at", { ascending: false });

    if (error) {
      throw new Error(
        `[price-read] latest-price read failed (${group.length} symbols): ${error.message}`
      );
    }

    for (const row of (data ?? []) as PriceLogRow[]) {
      const symbol = row.symbol.toUpperCase();
      if (hits.has(symbol)) continue; // newest-first, so the first one wins
      const hit = rowToHit(row);
      if (hit) hits.set(symbol, hit);
    }
  }

  // Anything with no priced row at all is genuinely absent. Report why, using
  // the most recent failure recorded for it if there is one.
  const stillMissing = wanted.filter((s) => !hits.has(s));
  const failures = new Map<string, string | null>();

  if (stillMissing.length > 0) {
    for (const group of chunk(stillMissing, SYMBOL_CHUNK)) {
      const { data } = await supabase
        .from("price_log")
        .select("symbol, failure_reason, captured_at")
        .in("symbol", group)
        .not("failure_reason", "is", null)
        .order("captured_at", { ascending: false });

      for (const row of data ?? []) {
        const symbol = String(row.symbol).toUpperCase();
        if (!failures.has(symbol)) failures.set(symbol, row.failure_reason as string);
      }
    }
  }

  const misses = new Map<string, PriceMiss>();
  for (const symbol of stillMissing) {
    misses.set(symbol, {
      symbol,
      reason: failures.has(symbol) ? "logged-failure" : "no-observation",
      detail: failures.get(symbol) ?? null,
    });
  }

  return { hits, misses, complete: misses.size === 0 };
}

/**
 * Every anchor of one kind across a date range, keyed `SYMBOL|YYYY-MM-DD`.
 *
 * Season-long scoring walks many weeks at once; without this it would issue
 * one query per week per league and re-read the same rows repeatedly.
 */
export async function getAnchorHistory(
  symbols: readonly string[],
  fromSessionDate: string,
  toSessionDate: string,
  kind: "open" | "close"
): Promise<Map<string, PriceHit>> {
  const wanted = [...new Set(symbols.map((s) => s.toUpperCase()))].filter(Boolean);
  if (wanted.length === 0) return new Map();

  const supabase = createServiceClient();
  const bySymbolDate = new Map<string, PriceHit>();

  for (const group of chunk(wanted, SYMBOL_CHUNK)) {
    // Paginated: a range read is the one call here that can genuinely exceed
    // PostgREST's 1000-row ceiling (150 symbols x 20 sessions = 3000 rows).
    const PAGE = 1000;
    let offset = 0;

    for (;;) {
      const { data, error } = await supabase
        .from("price_log")
        .select(
          "symbol, asset_class, price, failure_reason, change_percent, day_high, day_low, as_of, captured_at, source, set_by, session_date"
        )
        .in("symbol", group)
        .eq("kind", kind)
        .gte("session_date", fromSessionDate)
        .lte("session_date", toSessionDate)
        .is("superseded_at", null)
        .not("price", "is", null)
        .order("captured_at", { ascending: false })
        .range(offset, offset + PAGE - 1);

      if (error) {
        throw new Error(
          `[price-read] anchor history read failed (${kind} ${fromSessionDate}..${toSessionDate}): ${error.message}`
        );
      }

      const rows = (data ?? []) as (PriceLogRow & { session_date: string })[];
      for (const row of rows) {
        const hit = rowToHit(row);
        if (!hit) continue;
        const key = `${hit.symbol}|${row.session_date}`;
        if (!bySymbolDate.has(key)) bySymbolDate.set(key, hit);
      }

      if (rows.length < PAGE) break;
      offset += PAGE;
    }
  }

  return bySymbolDate;
}

/** Key helper so callers don't hand-build the `SYMBOL|DATE` string. */
export function historyKey(symbol: string, sessionDate: string): string {
  return `${symbol.toUpperCase()}|${sessionDate}`;
}
