"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatMoney, formatPct } from "@/lib/format";
import type { FreeAgentsPageData } from "@/lib/roster/types";
import { Button } from "@/components/Button";

export function FreeAgentsPageContent() {
  const [data, setData] = useState<FreeAgentsPageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [dropPickId, setDropPickId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/free-agents", { cache: "no-store" });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "Could not load free agents");
      setLoading(false);
      return;
    }
    setData(json as FreeAgentsPageData);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = filter.trim().toUpperCase();
    if (!q) return data.freeAgents;
    return data.freeAgents.filter(
      (s) =>
        s.symbol.includes(q) ||
        s.name.toUpperCase().includes(q) ||
        s.sector.toUpperCase().includes(q)
    );
  }, [data, filter]);

  async function handleClaim() {
    if (!selectedSymbol || !dropPickId) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/free-agents/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        droppedPickId: dropPickId,
        symbol: selectedSymbol,
      }),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(json.error ?? "Claim failed");
      return;
    }
    setData(json as FreeAgentsPageData);
    setSelectedSymbol(null);
    setDropPickId(null);
  }

  if (loading) {
    return (
      <p className="text-muted text-sm py-12 text-center">Loading free agents…</p>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
        {error}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-4">
      <section className="season-card">
        <h1 className="text-xl font-bold">Free Agents</h1>
        <p className="text-muted text-sm mt-1">
          S&P 500 stocks not rostered in your league. Drop a bench player and add
          a pickup to that bench slot at $0 — promote via IR swap on My Team.
        </p>
      </section>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <section className="season-card">
        <h2 className="season-card-title">Drop bench slot</h2>
        <div className="flex flex-wrap gap-2 mt-2">
          {data.benchSlots.map((slot) => (
            <button
              key={slot.pickId}
              type="button"
              className={`season-chip ${dropPickId === slot.pickId ? "season-chip--active" : ""}`}
              onClick={() =>
                setDropPickId((prev) =>
                  prev === slot.pickId ? null : slot.pickId
                )
              }
            >
              Drop {slot.symbol}
            </button>
          ))}
        </div>
      </section>

      <section className="season-card">
        <input
          type="search"
          placeholder="Filter by symbol, name, or sector…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="draft-input w-full mb-3"
        />
        <p className="text-xs text-muted mb-3">
          {filtered.length} available · {data.freeAgents.length} total unrostered
        </p>
        <div className="season-fa-list">
          {filtered.slice(0, 100).map((stock) => (
            <button
              key={stock.symbol}
              type="button"
              className={`season-fa-row ${selectedSymbol === stock.symbol ? "season-fa-row--selected" : ""}`}
              onClick={() =>
                setSelectedSymbol((prev) =>
                  prev === stock.symbol ? null : stock.symbol
                )
              }
            >
              <div className="min-w-0 flex-1 text-left">
                <p className="font-bold">{stock.symbol}</p>
                <p className="text-xs text-muted truncate">
                  {stock.name} · {stock.sector}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm">{formatMoney(stock.price)}</p>
                <p
                  className={`text-xs ${
                    stock.changePercent >= 0 ? "text-green-400" : "text-red-400"
                  }`}
                >
                  {formatPct(stock.changePercent)}
                </p>
              </div>
            </button>
          ))}
        </div>
      </section>

      <Button
        variant="primary"
        className="w-full"
        disabled={busy || !selectedSymbol || !dropPickId}
        onClick={handleClaim}
      >
        {busy
          ? "Claiming…"
          : selectedSymbol && dropPickId
            ? `Drop bench · add ${selectedSymbol}`
            : "Select a bench drop and free agent"}
      </Button>
    </div>
  );
}
