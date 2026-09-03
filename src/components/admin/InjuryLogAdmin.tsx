"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { InjuryLogSnapshot, OpenInjuryRow } from "@/lib/injuries/admin-queries";

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

export function InjuryLogAdmin({ initialSnapshot }: { initialSnapshot: InjuryLogSnapshot }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [running, setRunning] = useState(false);
  const [filter, setFilter] = useState("");
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/admin/injury-log/status", { cache: "no-store" });
    if (!res.ok) return;
    const data: InjuryLogSnapshot = await res.json();
    setSnapshot(data);
    return data;
  }, []);

  useEffect(() => {
    const pollIsLive = running || snapshot.runningRun !== null;
    if (!pollIsLive) {
      if (pollTimer.current) clearInterval(pollTimer.current);
      pollTimer.current = null;
      return;
    }
    if (pollTimer.current) return;
    pollTimer.current = setInterval(async () => {
      const data = await refresh();
      if (data && data.runningRun === null) {
        setRunning(false);
      }
    }, 1500);
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
      pollTimer.current = null;
    };
  }, [running, snapshot.runningRun, refresh]);

  async function runPollNow() {
    setRunning(true);
    try {
      await fetch("/api/admin/injury-log/poll", { method: "POST" });
    } finally {
      await refresh();
    }
  }

  const run = snapshot.runningRun ?? snapshot.latestRun;
  const runActive = snapshot.runningRun !== null;
  const issues = run?.issues ?? [];

  const filtered = snapshot.openInjuries.filter(
    (r) =>
      filter.trim() === "" ||
      r.playerName.toLowerCase().includes(filter.trim().toLowerCase()) ||
      (r.team ?? "").toLowerCase().includes(filter.trim().toLowerCase())
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
              style={{ background: "#1a5c2a", color: "#fff" }}
            >
              {snapshot.openInjuries.length} on IR
            </span>
            {issues.length > 0 && (
              <span
                className="text-xs font-semibold px-2 py-1 rounded"
                style={{ background: "#5c3a1a", color: "#fff" }}
              >
                {issues.length} issue{issues.length === 1 ? "" : "s"} last run
              </span>
            )}
          </div>
          <button
            onClick={runPollNow}
            disabled={runActive}
            className="text-sm font-semibold px-3 py-1.5 rounded"
            style={{
              background: runActive ? "#333" : "var(--color-gold, #d0ab48)",
              color: runActive ? "#999" : "#111",
              cursor: runActive ? "default" : "pointer",
            }}
          >
            {runActive ? "Poll running…" : "Run poll now"}
          </button>
        </div>

        {run && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-muted">
              <span>
                {runActive ? "Running" : run.status} — week {run.weekNumber ?? "?"} ·{" "}
                {run.entriesFetched} fetched · {run.playersMatched} matched ·{" "}
                {run.injuriesOpened} opened · {run.injuriesUpdated} updated ·{" "}
                {run.injuriesClosed} closed · {run.triggeredBy}
              </span>
              <span>{timeAgo(run.startedAt)}</span>
            </div>
            {run.error && (
              <p className="text-xs" style={{ color: "#e08080" }}>
                {run.error}
              </p>
            )}
          </div>
        )}
        {!run && <p className="text-xs text-muted">No poll has ever run.</p>}
      </div>

      {/* Issues from the latest run */}
      {issues.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold mb-2">Issues ({issues.length})</h2>
          <div
            className="rounded-lg border p-3 space-y-1"
            style={{ borderColor: "var(--color-dark-border, #2a3a5c)" }}
          >
            {issues.map((issue, i) => (
              <p key={i} className="text-xs" style={{ color: "#e0a840" }}>
                {issue}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Currently on IR */}
      <div>
        <div className="flex items-center justify-between mb-2 gap-2">
          <h2 className="text-sm font-semibold">
            Currently on IR ({snapshot.openInjuries.length})
          </h2>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by player or team…"
            className="text-sm px-2 py-1 rounded border bg-transparent"
            style={{ borderColor: "var(--color-dark-border, #2a3a5c)" }}
          />
        </div>
        <InjuryTable rows={filtered} />
      </div>
    </div>
  );
}

function InjuryTable({ rows }: { rows: OpenInjuryRow[] }) {
  return (
    <div
      className="overflow-x-auto rounded-lg border"
      style={{ borderColor: "var(--color-dark-border, #2a3a5c)", maxHeight: 480, overflowY: "auto" }}
    >
      <table className="w-full text-sm">
        <thead className="sticky top-0" style={{ background: "var(--color-dark-card, #0c1730)" }}>
          <tr style={{ color: "var(--color-gold, #d0ab48)" }}>
            <th className="text-left px-3 py-2">Player</th>
            <th className="text-left px-3 py-2">Team</th>
            <th className="text-left px-3 py-2">Pos</th>
            <th className="text-left px-3 py-2">Status</th>
            <th className="text-left px-3 py-2">Injury</th>
            <th className="text-left px-3 py-2">Note</th>
            <th className="text-left px-3 py-2">Since Wk</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.playerId} style={{ borderTop: "1px solid #2a3a5c" }}>
              <td className="px-3 py-1.5">{row.playerName}</td>
              <td className="px-3 py-1.5 text-muted">{row.team ?? "—"}</td>
              <td className="px-3 py-1.5 text-muted">{row.position ?? "—"}</td>
              <td className="px-3 py-1.5 font-mono">{row.status}</td>
              <td className="px-3 py-1.5 text-muted">{row.injury ?? "—"}</td>
              <td className="px-3 py-1.5 text-muted">{row.note ?? "—"}</td>
              <td className="px-3 py-1.5 text-muted">{row.startWeek ?? "—"}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td className="px-3 py-3 text-muted text-xs" colSpan={7}>
                No one tracked is currently on IR.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
