import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { isPricingFrozen } from "@/lib/market/pricing-freeze";

/**
 * Read-side queries for the admin Prices page only. Nothing here is used by
 * a player-facing route — this is where provenance (source, who set a price
 * by hand, when) is allowed to be visible, which is exactly what makes it
 * admin-only rather than something readers/get-prices exposes generally.
 */

export type SweepRow = {
  id: number;
  kind: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  symbolsRequested: number;
  symbolsOk: number;
  symbolsFailed: number;
  apiCalls: number;
  triggeredBy: string;
  error: string | null;
};

export type SymbolRow = {
  symbol: string;
  name: string | null;
  assetClass: "stock" | "crypto";
  latestPrice: number | null;
  latestKind: string | null;
  latestAsOf: string | null;
  latestCapturedAt: string | null;
  latestSource: string | null;
  failureReason: string | null;
  setByHand: boolean;
  note: string | null;
  todayOpen: number | null;
  todayClose: number | null;
};

export type PriceLogSnapshot = {
  frozen: boolean;
  latestSweep: SweepRow | null;
  runningSweep: SweepRow | null;
  rows: SymbolRow[];
  problemCount: number;
};

function mapSweep(r: Record<string, unknown>): SweepRow {
  return {
    id: r.id as number,
    kind: r.kind as string,
    status: r.status as string,
    startedAt: r.started_at as string,
    finishedAt: (r.finished_at as string) ?? null,
    symbolsRequested: r.symbols_requested as number,
    symbolsOk: r.symbols_ok as number,
    symbolsFailed: r.symbols_failed as number,
    apiCalls: r.api_calls as number,
    triggeredBy: r.triggered_by as string,
    error: (r.error as string) ?? null,
  };
}

export async function getPriceLogSnapshot(): Promise<PriceLogSnapshot> {
  const supabase = createServiceClient();

  const [
    { data: stocks },
    { data: crypto },
    { data: latest },
    { data: anchors },
    { data: sweeps },
  ] = await Promise.all([
    supabase.from("draft_pool").select("symbol, name"),
    supabase.from("crypto_pool").select("symbol, name"),
    supabase.from("price_log_latest").select("*"),
    supabase.from("price_log_today_anchors").select("*"),
    supabase
      .from("price_sweep")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(5),
  ]);

  const nameBySymbol = new Map<string, { name: string; assetClass: "stock" | "crypto" }>();
  for (const r of stocks ?? []) nameBySymbol.set(r.symbol, { name: r.name, assetClass: "stock" });
  for (const r of crypto ?? []) nameBySymbol.set(r.symbol, { name: r.name, assetClass: "crypto" });

  const latestBySymbol = new Map<string, Record<string, unknown>>();
  for (const r of latest ?? []) latestBySymbol.set(r.symbol as string, r);

  const openBySymbol = new Map<string, number>();
  const closeBySymbol = new Map<string, number>();
  for (const r of anchors ?? []) {
    if (r.kind === "open") openBySymbol.set(r.symbol as string, r.price as number);
    if (r.kind === "close") closeBySymbol.set(r.symbol as string, r.price as number);
  }

  // Union of the universe and anything ever logged — a symbol that somehow
  // has log rows but was removed from the pool should still be visible
  // rather than silently disappearing.
  const allSymbols = new Set<string>([...nameBySymbol.keys(), ...latestBySymbol.keys()]);

  const rows: SymbolRow[] = [...allSymbols].sort().map((symbol) => {
    const meta = nameBySymbol.get(symbol);
    const l = latestBySymbol.get(symbol);
    return {
      symbol,
      name: meta?.name ?? null,
      assetClass: meta?.assetClass ?? (l?.asset_class as "stock" | "crypto") ?? "stock",
      latestPrice: (l?.price as number) ?? null,
      latestKind: (l?.kind as string) ?? null,
      latestAsOf: (l?.as_of as string) ?? null,
      latestCapturedAt: (l?.captured_at as string) ?? null,
      latestSource: (l?.source as string) ?? null,
      failureReason: (l?.failure_reason as string) ?? null,
      setByHand: Boolean(l?.set_by),
      note: (l?.note as string) ?? null,
      todayOpen: openBySymbol.get(symbol) ?? null,
      todayClose: closeBySymbol.get(symbol) ?? null,
    };
  });

  const problemCount = rows.filter(
    (r) => r.latestPrice === null || r.failureReason !== null
  ).length;

  const sweepRows = (sweeps ?? []).map(mapSweep);
  const runningSweep = sweepRows.find((s) => s.status === "running") ?? null;
  const latestSweep = sweepRows[0] ?? null;

  return {
    frozen: isPricingFrozen(),
    latestSweep,
    runningSweep,
    rows,
    problemCount,
  };
}
