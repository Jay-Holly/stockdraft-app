"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PriceLogSnapshot, SymbolRow } from "@/lib/pricing/admin-queries";

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function isStale(row: SymbolRow): boolean {
  if (!row.latestCapturedAt) return true;
  return Date.now() - new Date(row.latestCapturedAt).getTime() > 30 * 60 * 1000;
}

function isProblem(row: SymbolRow): boolean {
  return row.latestPrice === null || row.failureReason !== null;
}

export function PriceLogAdmin({ initialSnapshot }: { initialSnapshot: PriceLogSnapshot }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [running, setRunning] = useState(false);
  const [filter, setFilter] = useState("");
  const [refetching, setRefetching] = useState<Set<string>>(new Set());
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/admin/price-log/status", { cache: "no-store" });
    if (!res.ok) return;
    const data: PriceLogSnapshot = await res.json();
    setSnapshot(data);
    return data;
  }, []);

  // Poll while a sweep is running (ours or the cron's), stop once it settles.
  useEffect(() => {
    const sweepIsLive = running || snapshot.runningSweep !== null;
    if (!sweepIsLive) {
      if (pollTimer.current) clearInterval(pollTimer.current);
      pollTimer.current = null;
      return;
    }
    if (pollTimer.current) return;
    pollTimer.current = setInterval(async () => {
      const data = await refresh();
      if (data && data.runningSweep === null) {
        setRunning(false);
      }
    }, 1200);
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
      pollTimer.current = null;
    };
  }, [running, snapshot.runningSweep, refresh]);

  async function runFullSweep() {
    setRunning(true);
    try {
      await fetch("/api/admin/price-log/sweep", { method: "POST" });
    } finally {
      await refresh();
    }
  }

  async function refetchOne(symbol: string) {
    setRefetching((prev) => new Set(prev).add(symbol));
    try {
      await fetch("/api/admin/price-log/sweep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols: [symbol] }),
      });
      await refresh();
    } finally {
      setRefetching((prev) => {
        const next = new Set(prev);
        next.delete(symbol);
        return next;
      });
    }
  }

  const sweep = snapshot.runningSweep ?? snapshot.latestSweep;
  const sweepActive = snapshot.runningSweep !== null;
  const progressPct =
    sweep && sweep.symbolsRequested > 0
      ? Math.min(100, Math.round(((sweep.symbolsOk + sweep.symbolsFailed) / sweep.symbolsRequested) * 100)
        )
      : 0;

  const problems = snapshot.rows.filter(isProblem);
  const filtered = snapshot.rows.filter(
    (r) =>
      filter.trim() === "" ||
      r.symbol.includes(filter.trim().toUpperCase()) ||
      (r.name ?? "").toLowerCase().includes(filter.trim().toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Health */}
      <div
        className="rounded-lg border p-4 space-y-3"
        style={{ borderColor: "var(--color-dark-border, #2a3a5c)" }}
      >
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span
              className="text-xs font-semibold px-2 py-1 rounded"
              style={{
                background: snapshot.frozen ? "#5c1a1a" : "#1a5c2a",
                color: "#fff",
              }}
            >
              {snapshot.frozen ? "FROZEN — no provider calls will be made" : "LIVE"}
            </span>
            {snapshot.problemCount > 0 && (
              <span
                className="text-xs font-semibold px-2 py-1 rounded"
                style={{ background: "#5c3a1a", color: "#fff" }}
              >
                {snapshot.problemCount} problem{snapshot.problemCount === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <button
            onClick={runFullSweep}
            disabled={sweepActive}
            className="text-sm font-semibold px-3 py-1.5 rounded"
            style={{
              background: sweepActive ? "#333" : "var(--color-gold, #d0ab48)",
              color: sweepActive ? "#999" : "#111",
              cursor: sweepActive ? "default" : "pointer",
            }}
          >
            {sweepActive ? "Sweep running…" : "Run sweep now"}
          </button>
        </div>

        {sweep && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-muted">
              <span>
                {sweepActive ? "Running" : sweep.status} — {sweep.symbolsOk + sweep.symbolsFailed}{" "}
                of {sweep.symbolsRequested} · {sweep.symbolsFailed} failed · {sweep.apiCalls} API
                calls · {sweep.triggeredBy}
              </span>
              <span>{timeAgo(sweep.startedAt)}</span>
            </div>
            <div
              className="h-2 rounded-full overflow-hidden"
              style={{ background: "#1a1a1a" }}
            >
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${progressPct}%`,
                  background: sweepActive ? "var(--color-gold, #d0ab48)" : "#4a7a4a",
                }}
              />
            </div>
            {sweep.error && (
              <p className="text-xs" style={{ color: "#e08080" }}>
                {sweep.error}
              </p>
            )}
          </div>
        )}
        {!sweep && <p className="text-xs text-muted">No sweep has ever run.</p>}
      </div>

      {/* Problems */}
      {problems.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold mb-2">
            Problems ({problems.length})
          </h2>
          <SymbolTable
            rows={problems}
            refetching={refetching}
            onRefetch={refetchOne}
          />
        </div>
      )}

      {/* Full grid */}
      <div>
        <div className="flex items-center justify-between mb-2 gap-2">
          <h2 className="text-sm font-semibold">All symbols ({snapshot.rows.length})</h2>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by symbol or name…"
            className="text-sm px-2 py-1 rounded border bg-transparent"
            style={{ borderColor: "var(--color-dark-border, #2a3a5c)" }}
          />
        </div>
        <SymbolTable rows={filtered} refetching={refetching} onRefetch={refetchOne} />
      </div>
    </div>
  );
}

function SymbolTable({
  rows,
  refetching,
  onRefetch,
}: {
  rows: SymbolRow[];
  refetching: Set<string>;
  onRefetch: (symbol: string) => void;
}) {
  return (
    <div
      className="overflow-x-auto rounded-lg border"
      style={{ borderColor: "var(--color-dark-border, #2a3a5c)", maxHeight: 480, overflowY: "auto" }}
    >
      <table className="w-full text-sm">
        <thead className="sticky top-0" style={{ background: "var(--color-dark-card, #0c1730)" }}>
          <tr style={{ color: "var(--color-gold, #d0ab48)" }}>
            <th className="text-left px-3 py-2">Symbol</th>
            <th className="text-left px-3 py-2">Price</th>
            <th className="text-left px-3 py-2">Kind</th>
            <th className="text-left px-3 py-2">Open</th>
            <th className="text-left px-3 py-2">Close</th>
            <th className="text-left px-3 py-2">Source</th>
            <th className="text-left px-3 py-2">Captured</th>
            <th className="text-left px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const problem = isProblem(row);
            const stale = !problem && isStale(row);
            return (
              <tr key={row.symbol} style={{ borderTop: "1px solid #2a3a5c" }}>
                <td className="px-3 py-1.5 font-mono">
                  {row.symbol}
                  {row.setByHand && (
                    <span className="ml-1 text-xs" style={{ color: "var(--color-gold, #d0ab48)" }} title={row.note ?? "set by hand"}>
                      ✎
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5">
                  {row.latestPrice !== null ? (
                    `$${row.latestPrice.toFixed(2)}`
                  ) : (
                    <span style={{ color: "#e08080" }}>
                      {row.failureReason ?? "never logged"}
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-muted">{row.latestKind ?? "—"}</td>
                <td className="px-3 py-1.5 text-muted">
                  {row.todayOpen !== null ? `$${row.todayOpen.toFixed(2)}` : "—"}
                </td>
                <td className="px-3 py-1.5 text-muted">
                  {row.todayClose !== null ? `$${row.todayClose.toFixed(2)}` : "—"}
                </td>
                <td className="px-3 py-1.5 text-muted">{row.latestSource ?? "—"}</td>
                <td className="px-3 py-1.5" style={{ color: stale ? "#e0a840" : undefined }}>
                  {timeAgo(row.latestCapturedAt)}
                </td>
                <td className="px-3 py-1.5">
                  <button
                    onClick={() => onRefetch(row.symbol)}
                    disabled={refetching.has(row.symbol)}
                    className="text-xs px-2 py-1 rounded border"
                    style={{ borderColor: "var(--color-dark-border, #2a3a5c)" }}
                  >
                    {refetching.has(row.symbol) ? "…" : "Re-fetch"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
