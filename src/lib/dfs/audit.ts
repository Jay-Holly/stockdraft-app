import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { isUsableQuote, safePctChange } from "@/lib/market/quote-guards";
import {
  fetchDailyOpenClose,
  hasTwelveDataKey,
  isTwelveDataSupported,
  TWELVE_DATA_CREDITS_PER_MINUTE,
  type DailyOpenClose,
} from "@/lib/market/twelve-data";
import {
  fetchCryptoSessionChecks,
  type CryptoSessionCheck,
} from "@/lib/market/coinpaprika";

type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * How far the stored price may sit from the independent source's before the
 * pair is treated as a disagreement rather than timing noise. Same threshold
 * the live lock/close cross-check uses — a stored ETH close ~8% off and a
 * stored GOOGL open ~5% off are the real misses this is sized against.
 */
export const AUDIT_TOLERANCE_PCT = 3;

/**
 * Symbols verified per cron invocation. Twelve Data's free tier bills one
 * credit per symbol and allows 8 per minute, so one invocation takes exactly
 * one minute's budget and the cron schedule supplies the rest. Rounds resume
 * where they left off, so a date with more symbols than one run can cover
 * simply finishes across the next few runs.
 */
export const SYMBOLS_PER_RUN = TWELVE_DATA_CREDITS_PER_MINUTE;

/** PostgREST's own response ceiling; paging has to step in units it allows. */
const PICK_PAGE_SIZE = 1000;

/**
 * Whether a recorded status means "ask again next run".
 *
 * `missing` is a lookup that failed and could succeed later — a timeout, a
 * poisoned batch, a spent credit budget that resets. `unrecoverable` is a
 * price no source can produce no matter how many times it is asked. Everything
 * else is a resolved value. Only the first is worth another credit.
 */
function isRetryableStatus(status: unknown): boolean {
  return status === "missing";
}

export type AuditPick = {
  pickId: string;
  symbol: string;
  openPrice: number | null;
  closePrice: number | null;
  contestType: "sddfs" | "sdwfs";
  contestId: string;
};

/**
 * `skipped` exists to stop a round that examined nothing from claiming it
 * verified everything.
 *
 * A round that finds no picks for its date used to report `passed` — the same
 * word it uses after confirming every price of a full trading day. Those are
 * opposite facts. Worse, "no picks found" is what a date mismatch looks like
 * from the inside: the query is well-formed, it simply asks about a day that
 * has no contests, and the round then certifies a day it never looked at.
 *
 * Fund release requires `passed` on both rounds, so a `skipped` round holds
 * the money exactly as a failure would — which is the right posture for a
 * round whose real message is "I have nothing to say about this date."
 */
export type RoundStatus = "running" | "passed" | "failed" | "skipped";

export type RoundResult = {
  round: 1 | 2;
  auditDate: string;
  status: RoundStatus;
  symbolsTotal: number;
  symbolsChecked: number;
  issues: string[];
  message: string;
};

/**
 * Every pick that this date's payouts depend on: SDDFS contests dated that
 * day, plus SDWFS contests that scored that day (weekly contests settle on
 * their Friday, so only that date's audit covers them).
 */
export async function collectAuditPicks(
  supabase: ServiceClient,
  auditDate: string
): Promise<AuditPick[]> {
  const picks: AuditPick[] = [];

  const { data: sddfsContests } = await supabase
    .from("sddfs_contests")
    .select("id")
    .eq("contest_date", auditDate)
    .in("status", ["locked", "scored"]);

  const { data: sdwfsContests } = await supabase
    .from("sdwfs_contests")
    .select("id")
    .gte("score_at", `${auditDate}T00:00:00Z`)
    .lte("score_at", `${auditDate}T23:59:59Z`)
    .in("status", ["locked", "scored"]);

  const sources: Array<{
    type: "sddfs" | "sdwfs";
    contestIds: string[];
    entryTable: "sddfs_entries" | "sdwfs_entries";
    pickTable: "sddfs_entry_picks" | "sdwfs_entry_picks";
  }> = [
    {
      type: "sddfs",
      contestIds: (sddfsContests ?? []).map((c) => c.id),
      entryTable: "sddfs_entries",
      pickTable: "sddfs_entry_picks",
    },
    {
      type: "sdwfs",
      contestIds: (sdwfsContests ?? []).map((c) => c.id),
      entryTable: "sdwfs_entries",
      pickTable: "sdwfs_entry_picks",
    },
  ];

  for (const source of sources) {
    for (const contestId of source.contestIds) {
      const { data: entries } = await supabase
        .from(source.entryTable)
        .select("id")
        .eq("contest_id", contestId);

      const entryIds = (entries ?? []).map((e) => e.id);
      if (entryIds.length === 0) continue;

      /**
       * Paged, because PostgREST caps a response at 1000 rows and says nothing
       * about it.
       *
       * At 12 picks an entry that ceiling arrives at 84 entrants — the
       * 2026-08-19 $2 contest had 86, so 1032 picks existed and the audit saw
       * 1000. The missing 32 could not be verified, could not be recovered,
       * and could not fail the round: they were simply absent from every list
       * this function returns, so the round passed judgement on a partial
       * contest while reporting full coverage.
       */
      for (let from = 0; ; from += PICK_PAGE_SIZE) {
        const { data: rows, error } = await supabase
          .from(source.pickTable)
          .select("id, symbol, open_price, close_price")
          .in("entry_id", entryIds)
          .order("id", { ascending: true })
          .range(from, from + PICK_PAGE_SIZE - 1);

        if (error) {
          throw new Error(
            `collectAuditPicks: ${source.pickTable} page at ${from} failed — ${error.message}`
          );
        }

        for (const row of rows ?? []) {
          picks.push({
            pickId: row.id,
            symbol: String(row.symbol).toUpperCase(),
            openPrice: row.open_price,
            closePrice: row.close_price,
            contestType: source.type,
            contestId,
          });
        }

        if (!rows || rows.length < PICK_PAGE_SIZE) break;
      }
    }
  }

  return picks;
}

function diffPct(a: number, b: number): number {
  return (Math.abs(a - b) / b) * 100;
}

/**
 * Writes a recovered open/close onto every pick that was short one.
 *
 * A stored value always wins — this only ever fills a blank, never overwrites
 * a price the live capture already got. Both rounds use it: round 1 to recover
 * what the 4 PM capture missed, round 2 to fill anything still blank when the
 * independent source is queried an hour later.
 */
async function applyRecoveredPrices(
  supabase: ServiceClient,
  symbolPicks: AuditPick[],
  source: DailyOpenClose | undefined,
  round: 1 | 2
): Promise<number> {
  let filled = 0;

  for (const pick of symbolPicks) {
    const open = isUsableQuote(pick.openPrice)
      ? pick.openPrice
      : isUsableQuote(source?.open)
        ? source.open
        : null;
    const close = isUsableQuote(pick.closePrice)
      ? pick.closePrice
      : isUsableQuote(source?.close)
        ? source.close
        : null;

    if (open === pick.openPrice && close === pick.closePrice) continue;

    const table =
      pick.contestType === "sddfs" ? "sddfs_entry_picks" : "sdwfs_entry_picks";

    await supabase
      .from(table)
      .update({
        open_price: open,
        close_price: close,
        pct_change: safePctChange(open, close),
      })
      .eq("id", pick.pickId);

    // Keep the caller's in-memory copy in step with the row just written, so
    // anything deriving a "stored" value after this sees the recovered price
    // rather than the blank that has already been filled.
    pick.openPrice = open;
    pick.closePrice = close;

    filled++;
    console.log(
      `[dfs-audit:${round}] ${pick.symbol} pick ${pick.pickId} backfilled open=${open} close=${close}`
    );
  }

  return filled;
}

async function upsertRun(
  supabase: ServiceClient,
  result: RoundResult
): Promise<void> {
  await supabase.from("dfs_audit_runs").upsert(
    {
      audit_date: result.auditDate,
      round: result.round,
      status: result.status,
      symbols_total: result.symbolsTotal,
      symbols_checked: result.symbolsChecked,
      issues: result.issues,
      completed_at:
        result.status === "running" ? null : new Date().toISOString(),
    },
    { onConflict: "audit_date,round" }
  );
}

/**
 * Round 1 — completeness, with recovery.
 *
 * A pick missing its open or close is not written off. Twelve Data's 1-minute
 * historical bars still carry that session's real 09:30 open and 16:00 close
 * hours later, so the true value gets backfilled onto the pick and its
 * pct_change recomputed. Only a symbol neither source can answer for stays
 * missing — and that fails the round, so nothing pays out on it.
 */
export async function runAuditRound1(auditDate: string): Promise<RoundResult> {
  const supabase = createServiceClient();
  const base = { round: 1 as const, auditDate };

  if (!hasTwelveDataKey()) {
    const result: RoundResult = {
      ...base,
      status: "failed",
      symbolsTotal: 0,
      symbolsChecked: 0,
      issues: ["TWELVE_DATA_API_KEY is not set — cannot verify or recover prices"],
      message:
        "Audit cannot run without the independent source. Funds stay held.",
    };
    await upsertRun(supabase, result);
    return result;
  }

  const picks = await collectAuditPicks(supabase, auditDate);
  if (picks.length === 0) {
    const result: RoundResult = {
      ...base,
      status: "skipped",
      symbolsTotal: 0,
      symbolsChecked: 0,
      issues: [],
      message:
        "No locked or scored contests found for this date — nothing audited. " +
        "If contests did run, this is a date mismatch, not a clean bill of health.",
    };
    await upsertRun(supabase, result);
    return result;
  }

  const allSymbols = [...new Set(picks.map((p) => p.symbol))];

  // Only symbols with something actually missing need a lookup this round.
  const incomplete = allSymbols.filter((symbol) =>
    picks.some(
      (p) =>
        p.symbol === symbol &&
        (!isUsableQuote(p.openPrice) || !isUsableQuote(p.closePrice))
    )
  );

  /**
   * Resume where earlier runs stopped — but only past symbols that actually
   * resolved.
   *
   * This used to skip anything with a row in `dfs_price_audits`, and a row is
   * written whether the lookup succeeded or failed. So "we asked and got
   * nothing" was recorded identically to "we asked and got the price," and the
   * symbol was never asked about again.
   *
   * The cron fires every two minutes for an hour precisely so a transient miss
   * gets another try. Marking failures complete cancelled all of it: one bad
   * response at 21:03 removed that symbol from the remaining 29 attempts. On
   * 2026-08-21 eleven picks across seven ordinary large caps — AT&T, Medtronic,
   * Ulta — stayed null through the entire window for this reason, and the four
   * contests holding them are still frozen.
   *
   * `unrecoverable` is the one failure that does stay done: a coin's 09:30 open
   * cannot be reconstructed after the fact by any source, so retrying it is
   * spend with no possible outcome. It still fails the round below — the money
   * stays held — it just stops re-asking a question with no answer.
   */
  const { data: alreadyChecked } = await supabase
    .from("dfs_price_audits")
    .select("symbol, open_status, close_status")
    .eq("audit_date", auditDate);

  const done = new Set(
    (alreadyChecked ?? [])
      .filter(
        (r) => !isRetryableStatus(r.open_status) && !isRetryableStatus(r.close_status)
      )
      .map((r) => r.symbol as string)
  );

  const pending = incomplete.filter((s) => !done.has(s));
  const batch = pending.slice(0, SYMBOLS_PER_RUN);

  const stockBatch = batch.filter(isTwelveDataSupported);
  const cryptoBatch = batch.filter((s) => !isTwelveDataSupported(s));

  const [stockBars, cryptoSessions] = await Promise.all([
    stockBatch.length > 0
      ? fetchDailyOpenClose(stockBatch, auditDate)
      : Promise.resolve({} as Record<string, DailyOpenClose>),
    cryptoBatch.length > 0
      ? fetchCryptoSessionChecks(cryptoBatch, auditDate)
      : Promise.resolve({} as Record<string, CryptoSessionCheck>),
  ]);

  const recovered: Record<string, DailyOpenClose> = { ...stockBars };

  // A coin's 16:00 ET close sits exactly on an hourly point, so it comes back
  // as a real price and is recoverable. Its 09:30 open does not — the hourly
  // series only brackets that moment. The midpoint of that bracket would look
  // like a price and would be a guess, and a guessed baseline is what every
  // later score gets measured against, so the open is deliberately left
  // unrecoverable rather than approximated.
  for (const [symbol, session] of Object.entries(cryptoSessions)) {
    recovered[symbol] = { symbol, open: null, close: session.close };
  }

  const issues: string[] = [];

  for (const symbol of batch) {
    const source = recovered[symbol];
    const symbolPicks = picks.filter((p) => p.symbol === symbol);
    const isCrypto = !isTwelveDataSupported(symbol);

    let openStatus = "ok";
    let closeStatus = "ok";

    const needsOpen = symbolPicks.some((p) => !isUsableQuote(p.openPrice));
    const needsClose = symbolPicks.some((p) => !isUsableQuote(p.closePrice));

    if (needsOpen) {
      if (isUsableQuote(source?.open)) {
        openStatus = "backfilled";
      } else if (isCrypto) {
        // Not a failed lookup — a question with no answer. Recorded as final
        // so later runs stop spending on it; it still fails the round below.
        openStatus = "unrecoverable";
        issues.push(
          `${symbol}: open missing — a coin's 09:30 price cannot be recovered after the fact, only bracketed`
        );
      } else {
        openStatus = "missing";
        issues.push(`${symbol}: open missing — will retry next run`);
      }
    }
    if (needsClose) {
      if (isUsableQuote(source?.close)) {
        closeStatus = "backfilled";
      } else {
        closeStatus = "missing";
        issues.push(`${symbol}: close missing — will retry next run`);
      }
    }

    await applyRecoveredPrices(supabase, symbolPicks, source, 1);

    await supabase.from("dfs_price_audits").upsert(
      {
        audit_date: auditDate,
        symbol,
        verified_open: source?.open ?? null,
        verified_close: source?.close ?? null,
        open_status: openStatus,
        close_status: closeStatus,
        checked_at: new Date().toISOString(),
      },
      { onConflict: "audit_date,symbol" }
    );
  }

  const remaining = pending.length - batch.length;
  const symbolsChecked = done.size + batch.length;

  // Symbols that were already complete need no lookup — they are "checked"
  // for round 1's purposes the moment nothing is missing from them.
  const completeCount = allSymbols.length - incomplete.length;

  if (remaining > 0) {
    const result: RoundResult = {
      ...base,
      status: "running",
      symbolsTotal: allSymbols.length,
      symbolsChecked: completeCount + symbolsChecked,
      issues,
      message: `${remaining} symbol(s) still to recover; continuing next run.`,
    };
    await upsertRun(supabase, result);
    return result;
  }

  // Re-read to judge the round on the final state, not on the pre-backfill snapshot.
  const finalPicks = await collectAuditPicks(supabase, auditDate);
  const stillBroken = finalPicks.filter(
    (p) => !isUsableQuote(p.openPrice) || !isUsableQuote(p.closePrice)
  );

  for (const pick of stillBroken) {
    issues.push(
      `${pick.symbol} (${pick.contestType} pick ${pick.pickId}): open=${pick.openPrice} close=${pick.closePrice}`
    );
  }

  const result: RoundResult = {
    ...base,
    status: stillBroken.length === 0 ? "passed" : "failed",
    symbolsTotal: allSymbols.length,
    symbolsChecked: allSymbols.length,
    issues,
    message:
      stillBroken.length === 0
        ? `All ${finalPicks.length} picks have a usable open and close.`
        : `${stillBroken.length} pick(s) still incomplete — funds stay held.`,
  };
  await upsertRun(supabase, result);
  return result;
}

/**
 * Round 2 — independent verification.
 *
 * Round 1 proves a number exists. Round 2 asks a second source whether it is
 * the right number. Anything past tolerance fails the round: two sources
 * disagreeing about a price is exactly the state that produced the corrupted
 * payouts this system exists to prevent.
 *
 * A value round 1 backfilled came from this same source, so re-reading it
 * proves nothing — those are reported as `unverifiable` (single-sourced)
 * rather than counted as confirmed.
 */
export async function runAuditRound2(auditDate: string): Promise<RoundResult> {
  const supabase = createServiceClient();
  const base = { round: 2 as const, auditDate };

  if (!hasTwelveDataKey()) {
    const result: RoundResult = {
      ...base,
      status: "failed",
      symbolsTotal: 0,
      symbolsChecked: 0,
      issues: ["TWELVE_DATA_API_KEY is not set — cannot verify prices"],
      message:
        "Audit cannot run without the independent source. Funds stay held.",
    };
    await upsertRun(supabase, result);
    return result;
  }

  const { data: round1 } = await supabase
    .from("dfs_audit_runs")
    .select("status")
    .eq("audit_date", auditDate)
    .eq("round", 1)
    .maybeSingle();

  /**
   * Round 2 used to refuse to run unless round 1 had passed — which withheld
   * the second attempt in exactly the case that needed it. On 2026-08-21 round
   * 1 failed with eleven unrecovered closes and round 2 responded by checking
   * zero symbols, so the only source that could still answer was never asked.
   *
   * A failed round 1 is now the reason to run, not the reason to stop: this
   * round both verifies what exists and fills what is still blank. The one
   * state still worth waiting on is `running`, where round 1 is mid-sweep and
   * its own next invocation is a better place to continue.
   */
  if (round1?.status === "running") {
    const result: RoundResult = {
      ...base,
      status: "skipped",
      symbolsTotal: 0,
      symbolsChecked: 0,
      issues: ["Round 1 is still sweeping — deferring to its next run."],
      message: "Round 1 in progress; round 2 will pick this date up after it settles.",
    };
    await upsertRun(supabase, result);
    return result;
  }

  const picks = await collectAuditPicks(supabase, auditDate);
  if (picks.length === 0) {
    const result: RoundResult = {
      ...base,
      status: "skipped",
      symbolsTotal: 0,
      symbolsChecked: 0,
      issues: [],
      message:
        "No locked or scored contests found for this date — nothing audited. " +
        "If contests did run, this is a date mismatch, not a clean bill of health.",
    };
    await upsertRun(supabase, result);
    return result;
  }

  const allSymbols = [...new Set(picks.map((p) => p.symbol))];

  const { data: existing } = await supabase
    .from("dfs_price_audits")
    .select("symbol, stored_open, stored_close, open_status, close_status")
    .eq("audit_date", auditDate);

  const rows = new Map(
    (existing ?? []).map((r) => [r.symbol as string, r])
  );

  // Round 2 has verified a symbol once it has stored_* recorded against it.
  const pending = allSymbols.filter(
    (s) => rows.get(s)?.stored_open == null && rows.get(s)?.stored_close == null
  );
  const batch = pending.slice(0, SYMBOLS_PER_RUN);

  // Each asset class gets checked against the source that can actually
  // identify it: equities by ticker, coins by their stored coin id.
  const stockBatch = batch.filter(isTwelveDataSupported);
  const cryptoBatch = batch.filter((s) => !isTwelveDataSupported(s));

  const [verified, cryptoChecks] = await Promise.all([
    stockBatch.length > 0
      ? fetchDailyOpenClose(stockBatch, auditDate)
      : Promise.resolve({} as Record<string, DailyOpenClose>),
    cryptoBatch.length > 0
      ? fetchCryptoSessionChecks(cryptoBatch, auditDate)
      : Promise.resolve({} as Record<string, CryptoSessionCheck>),
  ]);

  const issues: string[] = [];

  for (const symbol of batch) {
    const symbolPicks = picks.filter((p) => p.symbol === symbol);
    const prior = rows.get(symbol);
    const crypto = cryptoChecks[symbol];

    // Coins are hourly-only on the free window, so their open is bracketed by
    // the prices either side of 09:30 rather than matched to it. Presenting
    // that bracket as a single "verified price" would overstate what was
    // checked, so the midpoint is only ever used for the recorded number —
    // the pass/fail decision below uses the bracket itself.
    const source: DailyOpenClose | undefined = crypto
      ? {
          symbol,
          open: crypto.openBracket
            ? (crypto.openBracket[0] + crypto.openBracket[1]) / 2
            : null,
          close: crypto.close,
        }
      : verified[symbol];

    /**
     * Fill before verifying.
     *
     * This round runs an hour after round 1, against a budget that has had an
     * hour to recover, so it is a genuine second attempt at anything still
     * blank — not merely a re-read of what round 1 managed. A price it fills
     * here is single-sourced and gets labelled that way below; a blank left
     * unfilled fails the round and holds the money, exactly as before.
     *
     * A coin's open is excluded on purpose: `source.open` for crypto is the
     * midpoint of the hourly bracket either side of 09:30, which is an
     * estimate. Writing it would put a guessed baseline under every later
     * score, which is the one outcome worse than leaving the pick unpriced.
     */
    const recoverySource: DailyOpenClose | undefined = source
      ? { ...source, open: crypto ? null : source.open }
      : undefined;
    await applyRecoveredPrices(supabase, symbolPicks, recoverySource, 2);

    const storedOpen = symbolPicks.find((p) => isUsableQuote(p.openPrice))
      ?.openPrice as number | undefined;
    const storedClose = symbolPicks.find((p) => isUsableQuote(p.closePrice))
      ?.closePrice as number | undefined;

    // A value round 1 recovered came from this same source, so agreement here
    // proves only that the source is self-consistent — it is recorded as
    // single-sourced rather than confirmed. It is still compared, though: an
    // earlier version skipped the comparison entirely, which would have let a
    // recovered price that disagrees wildly with the primary source pass
    // unexamined. Reading it and labelling it honestly beats not looking.
    const openBackfilled = prior?.open_status === "backfilled";
    const closeBackfilled = prior?.close_status === "backfilled";

    let openStatus: string;
    let openDiff: number | null = null;
    if (!isUsableQuote(storedOpen)) {
      openStatus = "missing";
      issues.push(`${symbol}: no stored open to verify`);
    } else if (crypto) {
      // Bracket test: the stored open has to sit between the hour before and
      // the hour after it, with tolerance either side. Coarser than the equity
      // check by design — it will not notice a 2% wobble, but a wrong asset or
      // a corrupted baseline is nowhere near this range.
      if (!crypto.openBracket) {
        openStatus = "unverifiable";
      } else {
        const [low, high] = crypto.openBracket;
        const floor = low * (1 - AUDIT_TOLERANCE_PCT / 100);
        const ceiling = high * (1 + AUDIT_TOLERANCE_PCT / 100);
        const inside = storedOpen >= floor && storedOpen <= ceiling;
        openDiff = inside
          ? 0
          : diffPct(storedOpen, storedOpen < floor ? low : high);
        openStatus = inside ? (openBackfilled ? "unverifiable" : "ok") : "divergent";
        if (!inside) {
          issues.push(
            `${symbol} open: stored=${storedOpen} outside the ${low}–${high} hourly bracket`
          );
        }
      }
    } else if (!isUsableQuote(source?.open)) {
      openStatus = "unverifiable";
    } else {
      openDiff = diffPct(storedOpen, source.open);
      openStatus =
        openDiff > AUDIT_TOLERANCE_PCT
          ? "divergent"
          : openBackfilled
            ? "unverifiable"
            : "ok";
      if (openStatus === "divergent") {
        issues.push(
          `${symbol} open: stored=${storedOpen} verified=${source.open} (${openDiff.toFixed(1)}% apart)`
        );
      }
    }

    let closeStatus: string;
    let closeDiff: number | null = null;
    if (!isUsableQuote(storedClose)) {
      closeStatus = "missing";
      issues.push(`${symbol}: no stored close to verify`);
    } else if (!isUsableQuote(source?.close)) {
      closeStatus = "unverifiable";
    } else {
      closeDiff = diffPct(storedClose, source.close);
      closeStatus =
        closeDiff > AUDIT_TOLERANCE_PCT
          ? "divergent"
          : closeBackfilled
            ? "unverifiable"
            : "ok";
      if (closeStatus === "divergent") {
        issues.push(
          `${symbol} close: stored=${storedClose} verified=${source.close} (${closeDiff.toFixed(1)}% apart)`
        );
      }
    }

    await supabase.from("dfs_price_audits").upsert(
      {
        audit_date: auditDate,
        symbol,
        stored_open: storedOpen ?? null,
        stored_close: storedClose ?? null,
        verified_open: source?.open ?? prior?.["verified_open" as never] ?? null,
        verified_close: source?.close ?? null,
        open_diff_pct: openDiff,
        close_diff_pct: closeDiff,
        open_status: openStatus,
        close_status: closeStatus,
        checked_at: new Date().toISOString(),
      },
      { onConflict: "audit_date,symbol" }
    );
  }

  const remaining = pending.length - batch.length;
  if (remaining > 0) {
    const result: RoundResult = {
      ...base,
      status: "running",
      symbolsTotal: allSymbols.length,
      symbolsChecked: allSymbols.length - remaining,
      issues,
      message: `${remaining} symbol(s) still to verify; continuing next run.`,
    };
    await upsertRun(supabase, result);
    return result;
  }

  const { data: finalRows } = await supabase
    .from("dfs_price_audits")
    .select("symbol, open_status, close_status")
    .eq("audit_date", auditDate);

  const bad = (finalRows ?? []).filter(
    (r) =>
      r.open_status === "divergent" ||
      r.close_status === "divergent" ||
      r.open_status === "missing" ||
      r.close_status === "missing"
  );

  const singleSourced = (finalRows ?? []).filter(
    (r) => r.open_status === "unverifiable" || r.close_status === "unverifiable"
  );

  const allIssues = [...issues];
  for (const row of bad) {
    allIssues.push(
      `${row.symbol}: open=${row.open_status} close=${row.close_status}`
    );
  }

  const result: RoundResult = {
    ...base,
    status: bad.length === 0 ? "passed" : "failed",
    symbolsTotal: allSymbols.length,
    symbolsChecked: allSymbols.length,
    issues: allIssues,
    message:
      bad.length === 0
        ? `${allSymbols.length} symbol(s) verified` +
          (singleSourced.length > 0
            ? `; ${singleSourced.length} single-sourced (recovered, not independently confirmed)`
            : "")
        : `${bad.length} symbol(s) failed verification — funds stay held.`,
  };
  await upsertRun(supabase, result);
  return result;
}
