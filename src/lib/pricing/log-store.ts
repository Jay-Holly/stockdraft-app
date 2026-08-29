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
export async function writeObservations(
  observations: readonly Observation[]
): Promise<{ written: number; rejected: number }> {
  if (observations.length === 0) return { written: 0, rejected: 0 };

  const supabase = createServiceClient();

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
  };

  const rows: Row[] = observations.map((o) => ({
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
    for (const row of rows) {
      const single = await supabase.from("price_log").insert(row);
      if (single.error) {
        rejected++;
        console.error(
          `[price-log] rejected ${row.symbol} (${row.kind}, ${row.session_date}): ${single.error.message}`
        );
      } else {
        written++;
      }
    }
    return { written, rejected };
  }

  return { written: count ?? rows.length, rejected: 0 };
}
