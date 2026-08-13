import { NextResponse, type NextRequest } from "next/server";

import { verifyCronAuth } from "@/lib/cron/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { warmCryptoPoolCache } from "@/lib/coingecko/service";
import { fetchFinnhubQuotes } from "@/lib/finnhub/service";
import { fetchCryptoQuotes } from "@/lib/coingecko/service";
import { hasTwelveDataKey } from "@/lib/market/twelve-data";
import { activeSddfsContestDateIso } from "@/lib/dfs/contests";

export const dynamic = "force-dynamic";

/**
 * Runs at 9:15 ET, fifteen minutes ahead of the lock, and captures nothing.
 *
 * The lock time is the baseline, so it cannot be moved earlier without
 * measuring every pick from a pre-market price and handing everyone the
 * 9:15-to-9:30 opening gap they never traded. What can move earlier is
 * everything around it.
 *
 * Two jobs:
 *
 *  1. Warm what can be warmed. The crypto pool lives in module memory and
 *     starts empty on a cold serverless instance — that emptiness is what once
 *     misrouted real pool coins to the stock path. Loading it here gives the
 *     lock a decent chance of landing on an instance that already knows the
 *     pool. Only a chance: Vercel gives no guarantee the 9:30 invocation
 *     reuses this instance, so this is best-effort and never something the
 *     lock is allowed to depend on.
 *
 *  2. Find out now whether the sources are answering. If Finnhub or CoinGecko
 *     is failing at 9:15, that is worth knowing while there is still time to
 *     react, instead of discovering it from a contest full of empty baselines.
 *     A red preflight does not block the lock — the lock is still the best
 *     shot at a real 9:30 price — it just means nobody is surprised.
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

  // Warm the in-memory crypto pool.
  try {
    const poolSymbols = await warmCryptoPoolCache();
    checks.cryptoPool = { ok: poolSymbols.length > 0, coins: poolSymbols.length };
  } catch (err) {
    checks.cryptoPool = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Is CoinGecko answering, and does it cover every coin in today's lineups?
  try {
    const quotes = await fetchCryptoQuotes({ forceRefresh: true });
    const priced = Object.values(quotes).filter((q) => q.price > 0).length;
    checks.coingecko = { ok: priced > 0, priced };
  } catch (err) {
    checks.coingecko = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Is Finnhub answering? One well-known ticker is enough to tell up from
  // down without spending the lock's rate budget fifteen minutes early.
  try {
    const probe = await fetchFinnhubQuotes(["AAPL"], { cache: "no-store" });
    checks.finnhub = { ok: (probe.AAPL?.price ?? 0) > 0 };
  } catch (err) {
    checks.finnhub = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  checks.twelveDataKey = hasTwelveDataKey();

  const healthy =
    (checks.cryptoPool as { ok?: boolean })?.ok === true &&
    (checks.coingecko as { ok?: boolean })?.ok === true &&
    (checks.finnhub as { ok?: boolean })?.ok === true;

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
