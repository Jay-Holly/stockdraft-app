import "server-only";

import { getEasternParts } from "@/lib/season/eastern-time";
import {
  activeSddfsContestDateIso,
  ensureTodaysSddfsContests,
} from "@/lib/dfs/contests";
import { createServiceClient } from "@/lib/supabase/service";
import { finalizeSddfsContest } from "@/lib/sddfs/scoring";
import { isUsableQuote, safePctChange } from "@/lib/market/quote-guards";
import { getOpeningPricesWithRetry } from "@/lib/market/open-price-retry";
import { fillMissingOpens } from "@/lib/dfs/backfill";
import {
  fetchDailyOpenClose,
  hasTwelveDataKey,
  isTwelveDataSupported,
} from "@/lib/market/twelve-data";
import { isAuditGateEnabled } from "@/lib/dfs/audit-gate";

type ServiceClient = ReturnType<typeof createServiceClient>;

const MARKET_CLOSE_HOUR_ET = 16;

/** Locks any 'open' contests past lock_at and snapshots each pick's open price. */
async function lockDueContests(
  supabase: ServiceClient
): Promise<{ contestId: string; picksSnapshotted: number }[]> {
  const nowIso = new Date().toISOString();

  const { data: dueContests, error } = await supabase
    .from("sddfs_contests")
    .select("id")
    .eq("status", "open")
    .lte("lock_at", nowIso);

  if (error) {
    throw new Error(`Failed to load due contests: ${error.message}`);
  }
  if (!dueContests || dueContests.length === 0) return [];

  // Gather every pick across every due contest BEFORE quoting. Fetching per
  // contest meant one near-identical round of lookups per buy-in tier within
  // the same minute; the later rounds got rate-limited into returning nothing,
  // silently leaving those picks with no baseline at all. One fetch covers the
  // whole lock.
  const picksByContest = new Map<string, { id: string; symbol: string }[]>();

  for (const contest of dueContests) {
    const { data: entries } = await supabase
      .from("sddfs_entries")
      .select("id")
      .eq("contest_id", contest.id);

    const entryIds = (entries ?? []).map((e) => e.id);
    if (entryIds.length === 0) {
      picksByContest.set(contest.id, []);
      continue;
    }

    const { data: picks } = await supabase
      .from("sddfs_entry_picks")
      .select("id, symbol")
      .in("entry_id", entryIds);

    picksByContest.set(contest.id, picks ?? []);
  }

  const allSymbols = [
    ...new Set([...picksByContest.values()].flat().map((p) => p.symbol)),
  ];
  const prices =
    allSymbols.length > 0
      ? await getOpeningPricesWithRetry(allSymbols, { isDailyContest: true })
      : {};

  const results: { contestId: string; picksSnapshotted: number }[] = [];

  for (const contest of dueContests) {
    const picks = picksByContest.get(contest.id) ?? [];

    // Group picks by the price being written so the whole contest costs one
    // UPDATE per distinct price instead of one per pick.
    //
    // This loop used to issue a separate UPDATE for every pick, awaited in
    // sequence. That was fine while a contest meant ~70 picks. It stopped
    // being fine when contests started spanning the full draft pool: 12 due
    // contests came to 1,624 picks, and at typical round-trip latency the
    // write loop alone ran ~8 minutes — measured at 594s end to end, against
    // a 300s function limit. Production killed the run every time, so no
    // contest locked, so the backlog grew and the next run was slower still.
    // Three days of contests sat open because of it.
    const picksByPrice = new Map<number, string[]>();

    for (const pick of picks) {
      const openPrice = prices[pick.symbol.toUpperCase()];

      // Never persist a baseline we don't trust — every later score is
      // measured against it. Leaving it null scores the pick neutral.
      if (!isUsableQuote(openPrice)) {
        console.error(
          `[sddfs] no usable open quote for ${pick.symbol} (pick ${pick.id}); leaving baseline unset`
        );
        continue;
      }

      const ids = picksByPrice.get(openPrice) ?? [];
      ids.push(pick.id);
      picksByPrice.set(openPrice, ids);
    }

    for (const [openPrice, pickIds] of picksByPrice) {
      const { error: updateError } = await supabase
        .from("sddfs_entry_picks")
        .update({ open_price: openPrice })
        .in("id", pickIds);

      if (updateError) {
        // Leave the contest open rather than locking it with only some
        // baselines written — a partially-priced lock scores those picks
        // neutral and pays out on it. The next tick retries the whole thing.
        throw new Error(
          `Failed to snapshot ${pickIds.length} open price(s) for contest ${contest.id}: ${updateError.message}`
        );
      }
    }

    await supabase
      .from("sddfs_contests")
      .update({ status: "locked" })
      .eq("id", contest.id);

    results.push({ contestId: contest.id, picksSnapshotted: picks?.length ?? 0 });
  }

  return results;
}

/** Scores any 'locked' contests once the market has closed for their date. */
async function scoreClosedContests(
  supabase: ServiceClient
): Promise<{ contestId: string; entriesScored: number }[]> {
  const easternNow = getEasternParts(new Date());
  if (easternNow.hour < MARKET_CLOSE_HOUR_ET) return [];

  const contestDate = `${easternNow.year}-${String(easternNow.month).padStart(
    2,
    "0"
  )}-${String(easternNow.day).padStart(2, "0")}`;

  const { data: lockedContests, error } = await supabase
    .from("sddfs_contests")
    .select("id, contest_date")
    .eq("status", "locked")
    .lte("contest_date", contestDate);

  if (error) {
    throw new Error(`Failed to load locked contests: ${error.message}`);
  }
  if (!lockedContests || lockedContests.length === 0) return [];

  // Batched for the same reason as the lock: one quote round covering every
  // contest being scored, so later tiers can't be rate-limited into picks that
  // score neutral through no fault of the player.
  const picksByContest = new Map<
    string,
    { id: string; symbol: string; open_price: number | null }[]
  >();

  for (const contest of lockedContests) {
    const { data: entries } = await supabase
      .from("sddfs_entries")
      .select("id")
      .eq("contest_id", contest.id);

    const entryIds = (entries ?? []).map((e) => e.id);
    if (entryIds.length === 0) {
      picksByContest.set(contest.id, []);
      continue;
    }

    const { data: picks } = await supabase
      .from("sddfs_entry_picks")
      .select("id, symbol, open_price")
      .in("entry_id", entryIds);

    picksByContest.set(contest.id, picks ?? []);
  }

  // A contest's close must come from ITS OWN trading day, not from whatever
  // the market happens to be doing when the scorer finally reaches it.
  //
  // This used to take one live quote round and apply it to every locked
  // contest regardless of date. For a contest scoring at 4 PM on its own day
  // that is exactly right. For a backlogged one it is badly wrong twice over:
  // a contest from six days ago would be scored on a six-day move, and worse,
  // when a lock and a score run in the same pass the open and the close are
  // read from the same cache at the same instant — identical values, 0.00% on
  // every pick. That is what happened draining the 08-19 and 08-21 backlog:
  // 92% and 95% of their picks came out with open exactly equal to close.
  //
  // Today's contests still use a live quote, which is the real closing price
  // at that moment. Anything older is priced from that date's actual close via
  // the historical source, so a late score reports the day the contest
  // actually covered.
  const pricesByContest = new Map<string, Record<string, number>>();

  const symbolsFor = (contestIds: string[]): string[] => [
    ...new Set(
      contestIds.flatMap((id) =>
        (picksByContest.get(id) ?? []).map((p) => p.symbol)
      )
    ),
  ];

  const todaysContests = lockedContests.filter(
    (c) => c.contest_date === contestDate
  );
  const pastContests = lockedContests.filter(
    (c) => c.contest_date !== contestDate
  );

  if (todaysContests.length > 0) {
    const symbols = symbolsFor(todaysContests.map((c) => c.id));
    const live =
      symbols.length > 0
        ? await getOpeningPricesWithRetry(symbols, { isDailyContest: true })
        : {};
    for (const contest of todaysContests) {
      pricesByContest.set(contest.id, live);
    }
  }

  // One historical lookup per distinct past date, shared by every tier that
  // ran that day.
  const pastDates = [...new Set(pastContests.map((c) => c.contest_date))];
  for (const date of pastDates) {
    const sameDate = pastContests.filter((c) => c.contest_date === date);
    const symbols = symbolsFor(sameDate.map((c) => c.id));
    const closes: Record<string, number> = {};

    if (symbols.length > 0 && hasTwelveDataKey()) {
      // Equities only — a crypto ticker resolves to a different asset on this
      // source, so a coin with no recoverable close stays unscored rather than
      // being priced off the wrong instrument.
      const recoverable = symbols.filter(isTwelveDataSupported);
      const bars = await fetchDailyOpenClose(recoverable, date);
      for (const [symbol, bar] of Object.entries(bars)) {
        if (isUsableQuote(bar?.close)) closes[symbol.toUpperCase()] = bar.close!;
      }
    }

    for (const contest of sameDate) {
      pricesByContest.set(contest.id, closes);
    }
  }

  const results: { contestId: string; entriesScored: number }[] = [];

  for (const contest of lockedContests) {
    const picks = picksByContest.get(contest.id) ?? [];
    const prices = pricesByContest.get(contest.id) ?? {};

    // Batched for the same reason as the lock's write loop: one UPDATE per
    // distinct (close, pct) pair rather than one per pick. A close price and
    // its resulting pct_change are identical for every pick holding the same
    // symbol at the same open, so this collapses to a handful of writes.
    const picksByResult = new Map<
      string,
      { closePrice: number | null; pctChange: number | null; ids: string[] }
    >();

    for (const pick of picks) {
      const closePrice = prices[pick.symbol.toUpperCase()];
      const pctChange = safePctChange(pick.open_price, closePrice);

      if (pctChange === null) {
        console.error(
          `[sddfs] unscoreable pick ${pick.id} (${pick.symbol}): open=${pick.open_price} close=${closePrice}; scoring neutral`
        );
      }

      const resolvedClose = isUsableQuote(closePrice) ? closePrice : null;
      const key = `${resolvedClose}|${pctChange}`;
      const bucket = picksByResult.get(key) ?? {
        closePrice: resolvedClose,
        pctChange,
        ids: [],
      };
      bucket.ids.push(pick.id);
      picksByResult.set(key, bucket);
    }

    for (const { closePrice, pctChange, ids } of picksByResult.values()) {
      const { error: updateError } = await supabase
        .from("sddfs_entry_picks")
        .update({ close_price: closePrice, pct_change: pctChange })
        .in("id", ids);

      if (updateError) {
        // Same reasoning as the lock: a contest scored from a partial write
        // hands out rankings and payouts built on missing data. Leave it
        // locked and let the next run redo the whole contest.
        throw new Error(
          `Failed to write ${ids.length} close price(s) for contest ${contest.id}: ${updateError.message}`
        );
      }
    }

    // A pick with a real open but still no close after this run means the
    // quote fetch failed for it, not that it's genuinely unscoreable —
    // finalizing anyway pads it to 0% and can hand out rankings and real
    // payouts that don't reflect what actually happened. Leave the contest
    // locked so the next run retries; only a pick whose open itself was
    // never usable is treated as permanently neutral by design.
    const stillMissingClose = picks.some(
      (pick) =>
        isUsableQuote(pick.open_price) &&
        !isUsableQuote(prices[pick.symbol.toUpperCase()])
    );

    if (stillMissingClose) {
      console.error(
        `[sddfs] contest ${contest.id} has picks still missing a close price; holding off finalize, will retry next run`
      );
      continue;
    }

    // With the audit gate on, this scores and ranks the contest but credits
    // nobody — the release job pays out once both audit rounds pass. With it
    // off, crediting happens here as it always has.
    const { entriesScored } = await finalizeSddfsContest(supabase, contest.id, {
      creditWallets: !isAuditGateEnabled(),
    });
    results.push({ contestId: contest.id, entriesScored });
  }

  return results;
}

export async function runSddfsLifecycle(): Promise<{
  locked: { contestId: string; picksSnapshotted: number }[];
  scored: { contestId: string; entriesScored: number }[];
  backfilled: { filled: number; stillMissing: number };
}> {
  const supabase = createServiceClient();
  const locked = await lockDueContests(supabase);

  // Any pick the 9:30 lock couldn't price gets its real opening price here,
  // on whichever tick the second source can first report that session's 09:30
  // bar. Cheap no-op once nothing is missing.
  const backfilled = await fillMissingOpens(
    supabase,
    "sddfs",
    activeSddfsContestDateIso()
  );

  const scored = await scoreClosedContests(supabase);
  // Proactively create the next active contest date's rows (a no-op before
  // today's 4 PM ET close) so tomorrow's contests are already open and
  // enterable right after close, instead of waiting for someone to load
  // the lobby.
  await ensureTodaysSddfsContests(supabase, activeSddfsContestDateIso());
  return { locked, scored, backfilled };
}
