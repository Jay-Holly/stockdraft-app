import "server-only";

import { getLatestPrices } from "@/lib/pricing/read";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * A synchronous price lookup for the draft's time-critical paths.
 *
 * The bots' "fast" strategy paths cannot await a price per symbol — they screen
 * the entire 502-stock pool to choose a pick, and 502 awaits inside a live
 * draft clock is not viable. They previously solved this by reading
 * `sp500-fallback-quotes.json`, a snapshot committed to the repo, which was
 * synchronous and therefore fast.
 *
 * That file is gone, for good reason: a price nobody observed is not a price,
 * and in a draft it fixes the shares a manager holds for the whole season. But
 * removing it without replacing this capability broke the bots completely —
 * every stock screened at $0, became ineligible, and every bot skipped its
 * pick. Three rounds of a live test draft came back as SKIP for all four
 * managers.
 *
 * So the capability comes back, sourced from the price log instead of a file:
 * ONE bulk read of the whole pool, cached briefly, then synchronous lookups
 * against it. Faster than the per-symbol awaits it replaces, and every number
 * in it was actually observed and written down with its source.
 *
 * Prime it (async) at the entry point of a decision, then screen (sync) as
 * much as the strategy needs.
 */

type ScreenQuote = { price: number; changePercent: number };

let cache = new Map<string, ScreenQuote>();
let loadedAt = 0;

/** Long enough to cover one pick decision; short enough to stay live. */
const TTL_MS = 30_000;

export async function primeDraftPriceScreen(force = false): Promise<number> {
  if (!force && cache.size > 0 && Date.now() - loadedAt < TTL_MS) {
    return cache.size;
  }

  try {
    // Read the pool with the SERVICE client, not the user-scoped one.
    //
    // fetchDraftPool() reads cookies, which means it needs a request scope and
    // is subject to RLS as whichever user happens to be signed in. A bot pick
    // and a cron-driven autopick have no user at all, so it either throws or
    // silently returns nothing — and "silently returns nothing" is how the
    // crypto pool once emptied itself and left every coin unpriced (see the
    // comment in crypto-pool/server.ts, same bug, same fix). draft_pool is a
    // public reference table of symbols; reading it this way is correct.
    const supabase = createServiceClient();
    const { data, error } = await supabase.from("draft_pool").select("symbol");
    if (error) {
      console.error(`[draft-screen] could not read draft_pool: ${error.message}`);
      return cache.size;
    }
    const symbols = (data ?? []).map((r) => String(r.symbol).toUpperCase()).filter(Boolean);
    if (symbols.length === 0) {
      console.error("[draft-screen] draft pool came back empty — screening will find nothing");
      return cache.size;
    }

    const lookup = await getLatestPrices(symbols);
    const next = new Map<string, ScreenQuote>();
    for (const [symbol, hit] of lookup.hits) {
      next.set(symbol, { price: hit.price, changePercent: hit.changePercent ?? 0 });
    }

    // Only replace a populated cache with another populated one. A transient
    // read failure must not leave the bots screening against nothing — that is
    // the exact failure this module exists to prevent.
    if (next.size > 0) {
      cache = next;
      loadedAt = Date.now();
    } else {
      console.error("[draft-screen] price log returned no prices for the pool — keeping the previous screen");
    }

    if (lookup.misses.size > 0) {
      console.warn(`[draft-screen] ${lookup.misses.size} pool symbol(s) have no price in the log`);
    }
  } catch (error) {
    console.error(
      "[draft-screen] could not prime the screen:",
      error instanceof Error ? error.message : String(error)
    );
  }

  return cache.size;
}

/** Price for screening, or 0 when the log has none. Never a fabricated number. */
export function screenPrice(symbol: string): number {
  return cache.get(String(symbol ?? "").toUpperCase())?.price ?? 0;
}

export function screenQuote(symbol: string): ScreenQuote | null {
  return cache.get(String(symbol ?? "").toUpperCase()) ?? null;
}

/** Pool symbols that currently have a usable price. */
export function screenSymbols(): string[] {
  return [...cache.keys()];
}
