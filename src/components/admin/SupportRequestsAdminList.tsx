"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import type { SupportRequest } from "@/lib/support/admin";

export function SupportRequestsAdminList({
  initialRequests,
}: {
  initialRequests: SupportRequest[];
}) {
  const [requests, setRequests] = useState(initialRequests);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleResolve(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/support-requests/${id}/resolve`, {
        method: "POST",
      });
      if (res.ok) {
        setRequests((prev) =>
          prev.map((r) => (r.id === id ? { ...r, status: "resolved" } : r))
        );
      }
    } finally {
      setBusyId(null);
    }
  }

  if (requests.length === 0) {
    return (
      <p className="text-muted text-sm text-center py-8">
        No support requests yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {requests.map((r) => (
        <div
          key={r.id}
          className={`rounded-xl border p-4 ${
            r.status === "resolved"
              ? "border-dark-border bg-dark/20 opacity-60"
              : "border-amber-500/30 bg-amber-500/5"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{r.email}</p>
              {r.support_code && (
                <p className="text-xs text-gold mt-0.5">{r.support_code}</p>
              )}
              <p className="text-xs text-muted mt-1">
                {new Date(r.created_at).toLocaleString()}
              </p>
            </div>
            {r.status === "open" ? (
              <Button
                variant="secondary"
                onClick={() => void handleResolve(r.id)}
                disabled={busyId === r.id}
              >
                {busyId === r.id ? "…" : "Mark resolved"}
              </Button>
            ) : (
              <span className="text-xs text-emerald-300 shrink-0">
                Resolved
              </span>
            )}
          </div>
          <p className="text-sm text-white mt-3 whitespace-pre-wrap">
            {r.message}
          </p>
        </div>
      ))}
    </div>
  );
}
