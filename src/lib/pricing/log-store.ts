import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { getNyDateString } from "@/lib/market/hours";
import type { AssetClass } from "@/lib/pricing/store";

/**
 * Writes to `price_log` and `price_sweep` (migration 089).
 *
 * The store in ./store.ts still reads/writes the old `stock_prices` /
 * `crypto_prices` tables — those are the reader-facing cache and stay for now.
 * This file is the OTHER side: the logger's own record of every observation it
 * ever made, successful or not, which the old cache tables cannot represent
 * (they have no room for a failure, only a price).
 *
 * Nothing outside the logger writes here. Readers query this table (or a view
 * over it) but never insert into it — that split is what "readers never call
 * a provider" actually means at the database level.
 */

export type LogKind = "open" | "close" | "sample";
export type LogSource = "finnhub" | "coingecko" | "twelvedata" | "alpaca" | "manual";

export type Observation =
  | {
      symbol: string;
      assetClass: AssetClass;
      kind: LogKind;
      sessionDate: string; // YYYY-MM-DD, NY calendar day
      price: number;
      changePercent?: number;
      dayHigh?: number;
      dayLow?: number;
      asOf: Date;
      source: Exclude<LogSource, "manual">;
      sweepId: number;
      /** A second, independent source's price for the same instant. */
      verifiedPrice?: number;
      verifiedSource?: Exclude<LogSource, "manual">;
      verifyDiffPct?: number | null;
      verifyStatus?: "ok" | "divergent" | "unverified" | "recovered";
    }
  | {
      symbol: string;
      assetClass: AssetClass;
      kind: LogKind;
      sessionDate: string;
      failureReason:
        | "no-quote"
        | "too-stale"
        | "rate-limited"
        | "provider-error"
        | "frozen"
        | "not-attempted";
      source: Exclude<LogSource, "manual">;
      sweepId: number;
    };

export async function startSweep(input: {
  kind: LogKind;
  assetClass: AssetClass | "all";
  symbolsRequested: number;
  triggeredBy: "cron" | "manual";
  triggeredByUser?: string;
}): Promise<number> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("price_sweep")
    .insert({
      kind: input.kind,
      asset_class: input.assetClass,
      session_date: getNyDateString(),
      status: "running",
      symbols_requested: input.symbolsRequested,
      triggered_by: input.triggeredBy,
      triggered_by_user: input.triggeredByUser ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`[price-log] failed to start sweep: ${error?.message}`);
  }
  return data.id as number;
}

/**
 * Cheap, frequent progress update to the ONE sweep row — this is what lets
 * the admin page poll a single row and show "340 of 553 done" while a sweep
 * is still running, instead of staring at nothing until the whole thing
 * finishes and the counts appear all at once.
 */
export async function updateSweepProgress(
  sweepId: number,
  progress: { ok: number; failed: number; apiCalls: number }
): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("price_sweep")
    .update({
      symbols_ok: progress.ok,
      symbols_failed: progress.failed,
      api_calls: progress.apiCalls,
    })
    .eq("id", sweepId);

  if (error) {
    console.error(`[price-log] failed to update sweep ${sweepId} progress: ${error.message}`);
  }
}

export async function finishSweep(
  sweepId: number,
  result: {
    ok: number;
    failed: number;
    apiCalls: number;
    error?: string;
  }
): Promise<void> {
  const supabase = createServiceClient();
  const status =
    result.error != null
      ? "failed"
      : result.failed === 0
        ? "complete"
        : "partial";

  const { error } = await supabase
    .from("price_sweep")
    .update({
      status,
      finished_at: new Date().toISOString(),
      symbols_ok: result.ok,
      symbols_failed: result.failed,
      api_calls: result.apiCalls,
      error: result.error ?? null,
    })
    .eq("id", sweepId);

  if (error) {
    console.error(`[price-log] failed to close sweep ${sweepId}: ${error.message}`);
  }
}

/**
 * Which symbols already have a live (non-superseded) open/close anchor for a
 * session. The logger calls this before deciding whether an observation
 * should also be written as an anchor — see logger.ts.
 */
export async function existingAnchors(
  sessionDate: string,
  kind: "open" | "close"
): Promise<Set<string>> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("price_log")
    .select("symbol")
    .eq("session_date", sessionDate)
    .eq("kind", kind)
    .is("superseded_at", null)
    .not("price", "is", null);

  if (error) {
    console.error(`[price-log] failed to read existing ${kind} anchors: ${error.message}`);
    return new Set();
  }
  return new Set((data ?? []).map((r) => r.symbol as string));
}

/**
 * When was each symbol last attempted at all — success or failure, doesn't
 * matter, just "we touched it." Symbols with no row at all sort first (they
 * have never been touched, which beats any real timestamp).
 *
 * This is what lets a time-boxed run degrade gracefully across repeated
 * invocations: process the stalest symbols first, and whatever a deadline
 * cuts off this run is — by definition — no longer the stalest thing left,
 * so the next run naturally picks up somewhere else instead of retrying the
 * same alphabetical prefix every single time.
 */
export async function orderByStaleness(
  symbols: readonly string[]
): Promise<string[]> {
  if (symbols.length === 0) return [];

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("price_log_latest")
    .select("symbol, captured_at")
    .in("symbol", symbols);

  if (error) {
    console.error(`[price-log] failed to read staleness order: ${error.message}`);
    return [...symbols];
  }

  const lastSeenAt = new Map<string, number>();
  for (const row of data ?? []) {
    lastSeenAt.set(row.symbol as string, new Date(row.captured_at as string).getTime());
  }

  return [...symbols].sort((a, b) => {
    const ta = lastSeenAt.get(a) ?? -Infinity;
    const tb = lastSeenAt.get(b) ?? -Infinity;
    return ta - tb;
  });
}

/**
 * Writes one batch of observations. Never throws on a partial failure — a bad
 * row is logged and skipped so one symbol can't take the rest of the batch
 * down with it (see the migration's constraints: a rejected row here means
 * the observation itself was malformed, which should never happen if the
 * logger built it correctly, but the write must survive it if it does).
 */
/**
 * The last recorded price, high and low for each symbol — used to decide
 * whether a new sample says anything new.
 */
async function lastObservedValues(
  symbols: readonly string[]
): Promise<Map<string, { price: number; dayHigh: number | null; dayLow: number | null }>> {
  const out = new Map<string, { price: number; dayHigh: number | null; dayLow: number | null }>();
  if (symbols.length === 0) return out;

  const supabase = createServiceClient();
  const num = (v: unknown): number | null => {
    if (v == null) return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };

  // Chunked for the same reason every read here is: PostgREST caps rows and
  // URL length, and this system asks about 552 symbols at a time.
  for (let i = 0; i < symbols.length; i += 150) {
    const group = symbols.slice(i, i + 150);
    const { data, error } = await supabase
      .from("price_log_latest")
      .select("symbol, price, day_high, day_low")
      .in("symbol", group);

    if (error) {
      // Unknown previous state means we cannot prove a sample is redundant.
      // Write it. Dropping an observation we are unsure about would lose real
      // data; writing a duplicate only costs a row.
      console.error(`[price-log] staleness check failed, writing all: ${error.message}`);
      return new Map();
    }

    for (const row of data ?? []) {
      const price = num(row.price);
      if (price == null) continue;
      out.set(row.symbol as string, {
        price,
        dayHigh: num(row.day_high),
        dayLow: num(row.day_low),
      });
    }
  }

  return out;
}

/**
 * Writes observations, skipping samples that say nothing new.
 *
 * The logger sweeps every minute. Most of the 552 symbols do not move in any
 * given minute — and overnight, on weekends, and on holidays, none of the
 * stocks move at all. Writing an identical row every minute regardless would
 * add roughly 24 million rows a month, almost all of them saying exactly what
 * the row before them said.
 *
 * So a `sample` is written only when the price, the day's high, or the day's
 * low actually differs from the last thing recorded for that symbol. Nothing
 * downstream notices the difference: readers ask for the latest price, and the
 * latest price is unchanged precisely when no row was written.
 *
 * Two things are NEVER skipped:
 *   - `open` and `close` anchors. They are the scoring record, and a contest
 *     settling needs the anchor to exist for its own session even when the
 *     price is identical to yesterday's.
 *   - Failures. A symbol that stopped answering is news every single time,
 *     and the whole point of this table is that refusals are recorded rather
 *     than smoothed over.
 *
 * A useful side effect: because a row is now written only when something
 * changed, the existence of a row IS the change event. "Has anything moved
 * since I last looked?" becomes a cheap question, which is what live-updating
 * pages need.
 */
export type WrittenTick = { symbol: string; price: number; changePercent: number | null };

export async function writeObservations(
  observations: readonly Observation[]
): Promise<{
  written: number;
  rejected: number;
  skipped: number;
  /**
   * The priced observations this call actually stored — i.e. exactly what
   * changed. This is what gets pushed to open browsers; a symbol that did not
   * move produced no row and so appears nowhere here.
   */
  writtenTicks: WrittenTick[];
}> {
  if (observations.length === 0)
    return { written: 0, rejected: 0, skipped: 0, writtenTicks: [] };

  const supabase = createServiceClient();

  const isRedundantCandidate = (o: Observation): boolean =>
    o.kind === "sample" && "price" in o;

  const candidates = observations.filter(isRedundantCandidate);
  const previous = await lastObservedValues(candidates.map((o) => o.symbol));

  const same = (a: number | null | undefined, b: number | null): boolean => {
    const av = a ?? null;
    return av === b;
  };

  const toWrite = observations.filter((o) => {
    if (!isRedundantCandidate(o)) return true;
    const prev = previous.get(o.symbol);
    if (!prev) return true;
    const priced = o as Extract<Observation, { price: number }>;
    return !(
      priced.price === prev.price &&
      same(priced.dayHigh, prev.dayHigh) &&
      same(priced.dayLow, prev.dayLow)
    );
  });

  const skipped = observations.length - toWrite.length;
  if (toWrite.length === 0) return { written: 0, rejected: 0, skipped, writtenTicks: [] };

  const tickFor = (o: Observation): WrittenTick | null =>
    "price" in o
      ? { symbol: o.symbol, price: o.price, changePercent: o.changePercent ?? null }
      : null;

  // One uniform row shape (nulls for whichever side doesn't apply) rather
  // than a union of two shapes — the union type-checks per-observation but
  // Supabase's insert() wants every row in the batch to share one shape.
  type Row = {
    symbol: string;
    asset_class: string;
    kind: string;
    session_date: string;
    source: string;
    sweep_id: number;
    captured_at: string;
    price: number | null;
    change_percent: number | null;
    day_high: number | null;
    day_low: number | null;
    as_of: string | null;
    failure_reason: string | null;
    verified_price: number | null;
    verified_source: string | null;
    verify_diff_pct: number | null;
    verify_status: string | null;
    verified_at: string | null;
  };

  const rows: Row[] = toWrite.map((o) => ({
    symbol: o.symbol,
    asset_class: o.assetClass,
    kind: o.kind,
    session_date: o.sessionDate,
    source: o.source,
    sweep_id: o.sweepId,
    captured_at: new Date().toISOString(),
    price: "price" in o ? o.price : null,
    change_percent: "price" in o ? (o.changePercent ?? null) : null,
    day_high: "price" in o ? (o.dayHigh ?? null) : null,
    day_low: "price" in o ? (o.dayLow ?? null) : null,
    as_of: "price" in o ? o.asOf.toISOString() : null,
    failure_reason: "price" in o ? null : o.failureReason,
    verified_price: "price" in o ? (o.verifiedPrice ?? null) : null,
    verified_source: "price" in o ? (o.verifiedSource ?? null) : null,
    verify_diff_pct: "price" in o ? (o.verifyDiffPct ?? null) : null,
    verify_status: "price" in o ? (o.verifyStatus ?? null) : null,
    verified_at: "price" in o && o.verifyStatus ? new Date().toISOString() : null,
  }));

  const { error, count } = await supabase
    .from("price_log")
    .insert(rows, { count: "exact" });

  if (error) {
    // Batch insert failed as a whole (e.g. a constraint violation on one row
    // took the statement with it under Postgres' default atomicity). Retry
    // one at a time so 552 good rows aren't lost because of 1 bad one.
    let written = 0;
    let rejected = 0;
    const landed: WrittenTick[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const single = await supabase.from("price_log").insert(row);
      if (single.error) {
        rejected++;
        console.error(
          `[price-log] rejected ${row.symbol} (${row.kind}, ${row.session_date}): ${single.error.message}`
        );
      } else {
        written++;
        // Only a row that actually landed may be broadcast. Pushing a rejected
        // one would announce a price no reader can find, and the next refresh
        // would snap the page back to the old value.
        const tick = tickFor(toWrite[i]);
        if (tick) landed.push(tick);
      }
    }
    return { written, rejected, skipped, writtenTicks: landed };
  }

  return {
    written: count ?? rows.length,
    rejected: 0,
    skipped,
    writtenTicks: toWrite.map(tickFor).filter((t): t is WrittenTick => t !== null),
  };
}

/**
 * Is a sweep already in flight?
 *
 * At a one-minute cadence this matters: a healthy sweep finishes in about ten
 * seconds, but when Alpaca is down the fallback goes symbol-by-symbol through
 * Finnhub and has taken over nine minutes. Without this, every minute would
 * start another one on top of the last.
 *
 * A sweep older than `staleAfterMs` is treated as dead rather than running —
 * that is the "stuck reporting running forever" state a platform kill leaves
 * behind. It gets closed out honestly here instead of blocking every sweep
 * that follows it, which is exactly what happened to sweep #8.
 */
export async function findRunningSweep(
  staleAfterMs: number
): Promise<{ id: number; startedAt: string } | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("price_sweep")
    .select("id, started_at")
    .eq("status", "running")
    .order("started_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error(`[price-log] could not check for a running sweep: ${error.message}`);
    return null;
  }

  const row = data?.[0];
  if (!row) return null;

  const startedAt = row.started_at as string;
  const age = Date.now() - new Date(startedAt).getTime();

  if (age > staleAfterMs) {
    await supabase
      .from("price_sweep")
      .update({
        status: "aborted",
        finished_at: new Date().toISOString(),
        error: `Abandoned: still 'running' after ${Math.round(age / 1000)}s. Closed out by a later sweep.`,
      })
      .eq("id", row.id);
    console.error(`[price-log] closed out abandoned sweep ${row.id} (${Math.round(age / 1000)}s old)`);
    return null;
  }

  return { id: row.id as number, startedAt };
}

/**
 * Anchors that have been written but not yet corroborated.
 *
 * The open is written the instant the batch source reports it, so the trading
 * day can start on time, and is checked afterwards. This is that backlog.
 */
export async function listUnverifiedAnchors(
  sessionDate: string,
  kind: "open" | "close",
  limit: number
): Promise<Array<{ id: number; symbol: string; price: number }>> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("price_log")
    .select("id, symbol, price")
    .eq("session_date", sessionDate)
    .eq("kind", kind)
    .is("superseded_at", null)
    .not("price", "is", null)
    .eq("verify_status", "unverified")
    .limit(limit);

  if (error) {
    console.error(`[price-log] could not list unverified ${kind} anchors: ${error.message}`);
    return [];
  }

  return (data ?? []).map((r) => ({
    id: r.id as number,
    symbol: String(r.symbol).toUpperCase(),
    price: Number(r.price),
  }));
}

/**
 * Records a second source's opinion of an anchor that was already written.
 *
 * This UPDATES a row, which is worth being explicit about in an append-only
 * table: the price itself is never touched, and neither is anything about how
 * it was captured. Only the corroboration fields — which were empty because
 * the check had not happened yet — get filled in. The number a contest settles
 * on remains exactly what was first written, and if it turns out to be wrong
 * the correction path is still supersession, which preserves the original.
 */
export async function recordAnchorVerification(
  id: number,
  verification: {
    verifiedPrice: number | null;
    verifiedSource: LogSource | null;
    diffPct: number | null;
    status: "ok" | "divergent" | "unverified" | "recovered";
  }
): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("price_log")
    .update({
      verified_price: verification.verifiedPrice,
      verified_source: verification.verifiedSource,
      verify_diff_pct: verification.diffPct,
      verify_status: verification.status,
      verified_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    console.error(`[price-log] could not record verification for row ${id}: ${error.message}`);
  }
}
