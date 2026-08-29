import "server-only";

import { getEasternParts } from "@/lib/season/eastern-time";
import {
  activeSddfsContestDateIso,
  ensureTodaysSddfsContests,
} from "@/lib/dfs/contests";
import { createServiceClient } from "@/lib/supabase/service";
import { finalizeSddfsContest } from "@/lib/sddfs/scoring";
import { isUsableQuote, safePctChange } from "@/lib/market/quote-guards";
import { planContestLock } from "@/lib/dfs/lock-plan";
import { getOpeningPricesWithRetry } from "@/lib/market/open-price-retry";
import { fetchContestAnchors } from "@/lib/pricing/contest-quotes";
import { fillMissingOpens } from "@/lib/dfs/backfill";
import { isAuditGateEnabled } from "@/lib/dfs/audit-gate";

type ServiceClient = ReturnType<typeof createServiceClient>;

const MARKET_CLOSE_HOUR_ET = 16;

/**
 * PostgREST builds an `.in()` filter straight into the request URL, so one
 * UPDATE covering 1,000 ids (~37,000 characters of UUIDs) hits a gateway
 * URL-length limit and comes back a flat 400 Bad Request — confirmed
 * 2026-08-26 against today's $2 contest, where the QA coverage accounts
 * spread picks widely enough that exactly 1,000 of them landed on one
 * distinct close price/pct_change pair. Chunking keeps every request a safe
 * size regardless of how many picks collapse onto the same value.
 */
const UPDATE_CHUNK_SIZE = 200;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/** Locks any 'open' contests past lock_at and snapshots each pick's open price. */
async function lockDueContests(
  supabase: ServiceClient
): Promise<{
  locked: { contestId: string; picksSnapshotted: number }[];
  held: { contestId: string; missingSymbols: string[] }[];
}> {
  const nowIso = new Date().toISOString();

  const { data: dueContests, error } = await supabase
    .from("sddfs_contests")
    .select("id")
    .eq("status", "open")
    .lte("lock_at", nowIso);

  if (error) {
    throw new Error(`Failed to load due contests: ${error.message}`);
  }
  if (!dueContests || dueContests.length === 0) return { locked: [], held: [] };

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
  const held: { contestId: string; missingSymbols: string[] }[] = [];

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
    const plan = planContestLock(picks, prices);

    // See planContestLock: a contest locks only when every pick has a real
    // opening price. Anything less stays open and retries on the next tick.
    if (plan.decision === "hold") {
      console.error(
        `[sddfs] HOLDING contest ${contest.id}: no usable open price for ` +
          `${plan.missingSymbols.length} symbol(s) — ${plan.missingSymbols.join(", ")}. ` +
          `Contest stays open and will retry; it will NOT lock on partial baselines.`
      );
      held.push({ contestId: contest.id, missingSymbols: plan.missingSymbols });
      continue;
    }

    const { picksByPrice } = plan;

    for (const [openPrice, pickIds] of picksByPrice) {
      for (const idsChunk of chunk(pickIds, UPDATE_CHUNK_SIZE)) {
        const { error: updateError } = await supabase
          .from("sddfs_entry_picks")
          .update({ open_price: openPrice })
          .in("id", idsChunk);

        if (updateError) {
          // Leave the contest open rather than locking it with only some
          // baselines written — a partially-priced lock scores those picks
          // neutral and pays out on it. The next tick retries the whole thing.
          throw new Error(
            `Failed to snapshot ${idsChunk.length} of ${pickIds.length} open price(s) for contest ${contest.id}: ${updateError.message}`
          );
        }
      }
    }

    await supabase
      .from("sddfs_contests")
      .update({ status: "locked" })
      .eq("id", contest.id);

    results.push({ contestId: contest.id, picksSnapshotted: picks?.length ?? 0 });
  }

  return { locked: results, held };
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
    {
      id: string;
      symbol: string;
      open_price: number | null;
      close_price: number | null;
    }[]
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
      .select("id, symbol, open_price, close_price")
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

    if (symbols.length > 0) {
      // The close anchor the logger recorded for that session — the same
      // number every other contest on that date is scored against.
      //
      // This used to call Twelve Data directly to recover a missing close,
      // equities only (a crypto ticker resolves to a different asset there).
      // That asset-class hazard is gone: the log is keyed by symbol and holds
      // stocks and coins alike. A symbol with no close anchor stays unscored
      // rather than being priced off anything else.
      const anchors = await fetchContestAnchors(symbols, date, "close", "sddfs-recovery");
      for (const [symbol, close] of Object.entries(anchors)) {
        if (isUsableQuote(close)) closes[symbol.toUpperCase()] = close;
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
      // A retry that can't re-resolve a symbol must never touch a pick that
      // already has a real close from an earlier tick — this ran unconditionally
      // before, so any symbol still cold on a later retry got its close_price
      // overwritten with null, destroying progress a prior tick had already
      // made. Confirmed on the $2 contest on 2026-08-26: a second scoring
      // attempt made the gap worse (609 → 816 missing), not better, purely
      // from this clobbering. Skipping an already-closed pick makes every
      // retry additive instead of destructive.
      if (isUsableQuote(pick.close_price)) continue;

      const closePrice = prices[pick.symbol.toUpperCase()];
      const pctChange = safePctChange(pick.open_price, closePrice);

      if (!isUsableQuote(closePrice)) {
        console.error(
          `[sddfs] no usable close for ${pick.symbol} (pick ${pick.id}) this run; leaving as-is for the next retry`
        );
        continue;
      }

      const resolvedClose = closePrice;
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
      for (const idsChunk of chunk(ids, UPDATE_CHUNK_SIZE)) {
        const { error: updateError } = await supabase
          .from("sddfs_entry_picks")
          .update({ close_price: closePrice, pct_change: pctChange })
          .in("id", idsChunk);

        if (updateError) {
          // Same reasoning as the lock: a contest scored from a partial write
          // hands out rankings and payouts built on missing data. Leave it
          // locked and let the next run redo the whole contest.
          throw new Error(
            `Failed to write ${idsChunk.length} of ${ids.length} close price(s) for contest ${contest.id}: ${updateError.message}`
          );
        }
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
        !isUsableQuote(pick.close_price) &&
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
  held: { contestId: string; missingSymbols: string[] }[];
  scored: { contestId: string; entriesScored: number }[];
  backfilled: { filled: number; stillMissing: number };
}> {
  const supabase = createServiceClient();
  const { locked, held } = await lockDueContests(supabase);

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
  return { locked, held, scored, backfilled };
}
