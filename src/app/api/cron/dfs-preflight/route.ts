import { NextResponse, type NextRequest } from "next/server";

import { verifyCronAuth } from "@/lib/cron/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { getLatestPrices } from "@/lib/pricing/read";
import { activeSddfsContestDateIso } from "@/lib/dfs/contests";

export const dynamic = "force-dynamic";

/** A price older than this is not a credible basis for a 9:30 lock. */
const FRESH_WITHIN_MINUTES = 90;

/**
 * Runs at 9:15 ET, fifteen minutes ahead of the lock, and captures nothing.
 *
 * The lock time is the baseline, so it cannot be moved earlier without
 * measuring every pick from a pre-market price and handing everyone the
 * 9:15-to-9:30 opening gap they never traded. What can move earlier is
 * everything around it.
 *
 * What this checks changed with the price log. It used to probe the providers
 * directly — a CoinGecko refresh, a Finnhub quote for AAPL — because each
 * contest fetched its own prices at lock time and provider health was the
 * thing that decided whether the lock would work. Contests no longer call
 * providers at all: they read the log. So the question worth asking fifteen
 * minutes early is not "is Finnhub up?" but "does the log actually hold a
 * recent price for every symbol in today's lineups?"
 *
 * That is a strictly better question. It covers the exact symbols at risk
 * rather than one well-known probe ticker, it catches a healthy provider whose
 * sweep never ran, and it costs zero provider calls.
 *
 * A red preflight does not block the lock — it just means nobody is surprised.
 */
export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const contestDate = activeSddfsContestDateIso();
  const checks: Record<string, unknown> = {};

  // What is actually riding on today's lock.
  const { data: contests } = await supabase
    .from("sddfs_contests")
    .select("id")
    .eq("contest_date", contestDate)
    .eq("status", "open");

  const contestIds = (contests ?? []).map((c) => c.id);
  let symbols: string[] = [];

  if (contestIds.length > 0) {
    const { data: entries } = await supabase
      .from("sddfs_entries")
      .select("id")
      .in("contest_id", contestIds);
    const entryIds = (entries ?? []).map((e) => e.id);

    if (entryIds.length > 0) {
      const { data: picks } = await supabase
        .from("sddfs_entry_picks")
        .select("symbol")
        .in("entry_id", entryIds);
      symbols = [
        ...new Set((picks ?? []).map((p) => String(p.symbol).toUpperCase())),
      ];
    }

    checks.entries = entryIds.length;
  }

  checks.contestDate = contestDate;
  checks.contestsAwaitingLock = contestIds.length;
  checks.distinctSymbols = symbols.length;

  // Does the log hold a recent price for every symbol in today's lineups?
  let coverageOk = true;

  if (symbols.length === 0) {
    checks.coverage = { ok: true, note: "no lineups to price" };
  } else {
    try {
      const lookup = await getLatestPrices(symbols);
      const cutoff = Date.now() - FRESH_WITHIN_MINUTES * 60_000;

      const missing = [...lookup.misses.keys()];
      const stale = [...lookup.hits.values()]
        .filter((hit) => hit.capturedAt.getTime() < cutoff)
        .map((hit) => hit.symbol);

      coverageOk = missing.length === 0 && stale.length === 0;
      checks.coverage = {
        ok: coverageOk,
        priced: lookup.hits.size,
        missing: missing.slice(0, 20),
        missingCount: missing.length,
        stale: stale.slice(0, 20),
        staleCount: stale.length,
        freshWithinMinutes: FRESH_WITHIN_MINUTES,
      };
    } catch (err) {
      coverageOk = false;
      checks.coverage = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // Did a sweep actually run today, and how did it end? A sweep that never
  // started is invisible in per-symbol coverage until the prices go stale.
  try {
    const { data: sweeps } = await supabase
      .from("price_sweep")
      .select("id, kind, status, started_at, finished_at, symbols_ok, symbols_failed")
      .order("started_at", { ascending: false })
      .limit(1);

    const last = sweeps?.[0] ?? null;
    checks.lastSweep = last
      ? {
          id: last.id,
          kind: last.kind,
          status: last.status,
          startedAt: last.started_at,
          finishedAt: last.finished_at,
          ok: last.symbols_ok,
          failed: last.symbols_failed,
        }
      : { none: true };
  } catch (err) {
    checks.lastSweep = { error: err instanceof Error ? err.message : String(err) };
  }

  const healthy = coverageOk;

  if (!healthy) {
    console.error(
      `[dfs-preflight] ${contestDate} NOT healthy 15 minutes before lock:`,
      JSON.stringify(checks)
    );
  } else {
    console.log(`[dfs-preflight] ${contestDate} ready:`, JSON.stringify(checks));
  }

  return NextResponse.json({ ok: true, healthy, checks });
}
