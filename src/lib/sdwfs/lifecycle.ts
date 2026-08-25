import "server-only";

import {
  activeSdwfsContestWeekIso,
  ensureThisWeeksSdwfsContests,
} from "@/lib/wfs/contests";
import { createServiceClient } from "@/lib/supabase/service";
import { finalizeSdwfsContest } from "@/lib/sdwfs/scoring";
import { isUsableQuote, safePctChange } from "@/lib/market/quote-guards";
import { getOpeningPricesWithRetry } from "@/lib/market/open-price-retry";
import { fillMissingOpens } from "@/lib/dfs/backfill";
import {
  fetchDailyOpenClose,
  hasTwelveDataKey,
  isTwelveDataSupported,
} from "@/lib/market/twelve-data";
import { easternDateIso } from "@/lib/dfs/audit-dates";
import { isAuditGateEnabled } from "@/lib/dfs/audit-gate";

type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * Locks any 'open' contests past lock_at (Monday 9 AM ET) and snapshots
 * each pick's open price using a live Monday-morning quote.
 */
async function lockDueContests(
  supabase: ServiceClient
): Promise<{ contestId: string; picksSnapshotted: number }[]> {
  const nowIso = new Date().toISOString();

  const { data: dueContests, error } = await supabase
    .from("sdwfs_contests")
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
      .from("sdwfs_entries")
      .select("id")
      .eq("contest_id", contest.id);

    const entryIds = (entries ?? []).map((e) => e.id);
    if (entryIds.length === 0) {
      picksByContest.set(contest.id, []);
      continue;
    }

    const { data: picks } = await supabase
      .from("sdwfs_entry_picks")
      .select("id, symbol")
      .in("entry_id", entryIds);

    picksByContest.set(contest.id, picks ?? []);
  }

  const allSymbols = [
    ...new Set([...picksByContest.values()].flat().map((p) => p.symbol)),
  ];
  const prices =
    allSymbols.length > 0
      ? await getOpeningPricesWithRetry(allSymbols, { isDailyContest: false })
      : {};

  const results: { contestId: string; picksSnapshotted: number }[] = [];

  for (const contest of dueContests) {
    const picks = picksByContest.get(contest.id) ?? [];

    // One UPDATE per distinct price instead of one per pick — see the matching
    // comment in sddfs/lifecycle.ts. The per-pick version ran ~8 minutes on a
    // 1,600-pick backlog against a 300s function limit, so nothing ever
    // locked.
    const picksByPrice = new Map<number, string[]>();

    for (const pick of picks) {
      const openPrice = prices[pick.symbol.toUpperCase()];

      // Never persist a baseline we don't trust — every later score is
      // measured against it. Leaving it null scores the pick neutral.
      if (!isUsableQuote(openPrice)) {
        console.error(
          `[sdwfs] no usable open quote for ${pick.symbol} (pick ${pick.id}); leaving baseline unset`
        );
        continue;
      }

      const ids = picksByPrice.get(openPrice) ?? [];
      ids.push(pick.id);
      picksByPrice.set(openPrice, ids);
    }

    for (const [openPrice, pickIds] of picksByPrice) {
      const { error: updateError } = await supabase
        .from("sdwfs_entry_picks")
        .update({ open_price: openPrice })
        .in("id", pickIds);

      if (updateError) {
        throw new Error(
          `Failed to snapshot ${pickIds.length} open price(s) for contest ${contest.id}: ${updateError.message}`
        );
      }
    }

    await supabase
      .from("sdwfs_contests")
      .update({ status: "locked" })
      .eq("id", contest.id);

    results.push({ contestId: contest.id, picksSnapshotted: picks?.length ?? 0 });
  }

  return results;
}

/**
 * Scores any 'locked' contests once past their score_at (Friday 4 PM ET
 * close). Each pick's return is Monday's snapshotted open_price vs that
 * week's Friday close — cumulative week return, not day-over-day.
 *
 * The Friday close is a live quote only when the week is being scored on the
 * day it actually ended. A week scored later is priced from that Friday's real
 * session bar, so a delayed run still reports the week it covered rather than
 * whatever the market has done since.
 */
async function scoreClosedContests(
  supabase: ServiceClient
): Promise<{ contestId: string; entriesScored: number }[]> {
  const nowIso = new Date().toISOString();

  const { data: lockedContests, error } = await supabase
    .from("sdwfs_contests")
    .select("id, score_at")
    .eq("status", "locked")
    .lte("score_at", nowIso);

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
      .from("sdwfs_entries")
      .select("id")
      .eq("contest_id", contest.id);

    const entryIds = (entries ?? []).map((e) => e.id);
    if (entryIds.length === 0) {
      picksByContest.set(contest.id, []);
      continue;
    }

    const { data: picks } = await supabase
      .from("sdwfs_entry_picks")
      .select("id, symbol, open_price")
      .in("entry_id", entryIds);

    picksByContest.set(contest.id, picks ?? []);
  }

  // A week's close belongs to the session it actually ended on — score_at is
  // that week's Friday 4 PM ET — not to whenever the scorer happens to reach
  // it. Applying one live quote round to every locked contest regardless of
  // age measures the wrong span on anything scored late, and when a lock and
  // a score run in the same pass it reads the open and the close from the
  // same cache at the same instant, producing 0.00% on every pick. That is
  // what happened to the SDDFS 08-19 and 08-21 backlog; this is the same fix
  // applied before it can happen here.
  const todayIso = easternDateIso();
  const closeDateFor = (scoreAt: string | null): string =>
    scoreAt ? easternDateIso(new Date(scoreAt)) : todayIso;

  const pricesByContest = new Map<string, Record<string, number>>();

  const symbolsFor = (contestIds: string[]): string[] => [
    ...new Set(
      contestIds.flatMap((id) =>
        (picksByContest.get(id) ?? []).map((p) => p.symbol)
      )
    ),
  ];

  const currentWeek = lockedContests.filter(
    (c) => closeDateFor(c.score_at) === todayIso
  );
  const pastWeeks = lockedContests.filter(
    (c) => closeDateFor(c.score_at) !== todayIso
  );

  if (currentWeek.length > 0) {
    const symbols = symbolsFor(currentWeek.map((c) => c.id));
    const live =
      symbols.length > 0
        ? await getOpeningPricesWithRetry(symbols, { isDailyContest: false })
        : {};
    for (const contest of currentWeek) {
      pricesByContest.set(contest.id, live);
    }
  }

  // One historical lookup per distinct close date, shared by every tier that
  // ended that day.
  const pastDates = [...new Set(pastWeeks.map((c) => closeDateFor(c.score_at)))];
  for (const date of pastDates) {
    const sameDate = pastWeeks.filter((c) => closeDateFor(c.score_at) === date);
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

    // Batched for the same reason as the lock — see sddfs/lifecycle.ts.
    const picksByResult = new Map<
      string,
      { closePrice: number | null; pctChange: number | null; ids: string[] }
    >();

    for (const pick of picks) {
      const closePrice = prices[pick.symbol.toUpperCase()];
      const pctChange = safePctChange(pick.open_price, closePrice);

      if (pctChange === null) {
        console.error(
          `[sdwfs] unscoreable pick ${pick.id} (${pick.symbol}): open=${pick.open_price} close=${closePrice}; scoring neutral`
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
        .from("sdwfs_entry_picks")
        .update({ close_price: closePrice, pct_change: pctChange })
        .in("id", ids);

      if (updateError) {
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
        `[sdwfs] contest ${contest.id} has picks still missing a close price; holding off finalize, will retry next run`
      );
      continue;
    }

    // With the audit gate on, this scores and ranks the contest but credits
    // nobody — the release job pays out once both audit rounds pass. With it
    // off, crediting happens here as it always has.
    const { entriesScored } = await finalizeSdwfsContest(supabase, contest.id, {
      creditWallets: !isAuditGateEnabled(),
    });
    results.push({ contestId: contest.id, entriesScored });
  }

  return results;
}

export async function runSdwfsLifecycle(): Promise<{
  locked: { contestId: string; picksSnapshotted: number }[];
  scored: { contestId: string; entriesScored: number }[];
  backfilled: { filled: number; stillMissing: number };
}> {
  const supabase = createServiceClient();
  const locked = await lockDueContests(supabase);

  // Any pick the Monday lock couldn't price gets its real opening price here,
  // on whichever tick the second source can first report that 09:30 bar.
  const backfilled = await fillMissingOpens(
    supabase,
    "sdwfs",
    activeSdwfsContestWeekIso()
  );

  const scored = await scoreClosedContests(supabase);
  // Proactively create the next active week's contest rows (a no-op before
  // this week's Friday 4 PM ET close) so next week's contests are already
  // open and enterable right after close, instead of waiting for someone
  // to load the lobby.
  await ensureThisWeeksSdwfsContests(supabase, activeSdwfsContestWeekIso());
  return { locked, scored, backfilled };
}
