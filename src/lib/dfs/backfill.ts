import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { isUsableQuote, safePctChange } from "@/lib/market/quote-guards";
import {
  fetchDailyOpenClose,
  hasTwelveDataKey,
  isTwelveDataSupported,
  TWELVE_DATA_CREDITS_PER_MINUTE,
} from "@/lib/market/twelve-data";

type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * Fills the gaps Finnhub left at the 9:30 lock, and nothing else.
 *
 * Finnhub owns every price it actually returned — this never touches one.
 * It only looks for picks that came out of the lock with no open at all and
 * asks the second source for that session's real 09:30 bar.
 *
 * Why this runs on a sweep instead of inline at 9:30: the second source's
 * free tier serves delayed data, so at 9:30:00 it cannot yet report the 9:30
 * price. The 09:30 one-minute bar becomes retrievable a short while after the
 * fact, so the lifecycle cron (every 15 minutes) picks it up on a later tick
 * — the true opening price, backfilled within the hour, long before the 4 PM
 * close or any payout. Anything still unfilled by then is caught again by the
 * nightly audit.
 */
export async function fillMissingOpens(
  supabase: ServiceClient,
  contestType: "sddfs" | "sdwfs",
  contestDate: string
): Promise<{ filled: number; stillMissing: number }> {
  if (!hasTwelveDataKey()) return { filled: 0, stillMissing: 0 };

  const contestTable =
    contestType === "sddfs" ? "sddfs_contests" : "sdwfs_contests";
  const entryTable = contestType === "sddfs" ? "sddfs_entries" : "sdwfs_entries";
  const pickTable =
    contestType === "sddfs" ? "sddfs_entry_picks" : "sdwfs_entry_picks";
  const dateColumn = contestType === "sddfs" ? "contest_date" : "week_start_date";

  const { data: contests } = await supabase
    .from(contestTable)
    .select("id")
    .eq(dateColumn, contestDate)
    .in("status", ["locked", "scored"]);

  if (!contests || contests.length === 0) return { filled: 0, stillMissing: 0 };

  const { data: entries } = await supabase
    .from(entryTable)
    .select("id")
    .in(
      "contest_id",
      contests.map((c) => c.id)
    );

  const entryIds = (entries ?? []).map((e) => e.id);
  if (entryIds.length === 0) return { filled: 0, stillMissing: 0 };

  const { data: picks } = await supabase
    .from(pickTable)
    .select("id, symbol, open_price, close_price")
    .in("entry_id", entryIds)
    .is("open_price", null);

  if (!picks || picks.length === 0) return { filled: 0, stillMissing: 0 };

  const symbols = [
    ...new Set(picks.map((p) => String(p.symbol).toUpperCase())),
  ];

  // Equities only. A crypto ticker on the second source can resolve to a
  // different asset with the same letters, so a coin missing its open stays
  // missing here and is recovered by retrying CoinGecko instead.
  const recoverable = symbols.filter(isTwelveDataSupported);
  const skipped = symbols.filter((s) => !isTwelveDataSupported(s));
  if (skipped.length > 0) {
    console.warn(
      `[dfs-backfill] ${contestType} ${skipped.join(", ")} still unpriced — crypto is not recoverable from the second source`
    );
  }
  if (recoverable.length === 0) {
    return { filled: 0, stillMissing: picks.length };
  }

  // One minute's worth of the second source's free-tier budget per sweep;
  // the next lifecycle tick picks up anything left over.
  const batch = recoverable.slice(0, TWELVE_DATA_CREDITS_PER_MINUTE);
  const bars = await fetchDailyOpenClose(batch, contestDate);

  let filled = 0;

  for (const pick of picks) {
    const symbol = String(pick.symbol).toUpperCase();
    const open = bars[symbol]?.open;
    if (!isUsableQuote(open)) continue;

    const { error } = await supabase
      .from(pickTable)
      .update({
        open_price: open,
        pct_change: safePctChange(open, pick.close_price),
      })
      .eq("id", pick.id);

    if (error) {
      console.error(
        `[dfs-backfill] ${symbol} pick ${pick.id}: ${error.message}`
      );
      continue;
    }

    filled++;
    console.log(
      `[dfs-backfill] ${contestType} ${symbol} pick ${pick.id}: open backfilled to ${open}`
    );
  }

  return { filled, stillMissing: picks.length - filled };
}
