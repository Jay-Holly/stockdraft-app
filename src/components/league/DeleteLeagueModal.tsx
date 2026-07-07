"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { LeagueSupportId } from "@/components/league/LeagueSupportId";
import type { LeagueDeletePreview } from "@/lib/league/delete-league";

export function DeleteLeagueModal({
  open,
  leagueId,
  leagueName,
  supportCode,
  onClose,
}: {
  open: boolean;
  leagueId: string | null;
  leagueName: string;
  supportCode: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [preview, setPreview] = useState<LeagueDeletePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !leagueId) {
      setPreview(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const res = await fetch(
          `/api/leagues/delete-preview?leagueId=${encodeURIComponent(leagueId)}`,
          { cache: "no-store" }
        );
        const data = (await res.json()) as LeagueDeletePreview & { error?: string };

        if (cancelled) return;

        if (!res.ok) {
          setError(data.error ?? "Could not load league details.");
          setPreview(null);
          return;
        }

        setPreview(data);
      } catch {
        if (!cancelled) {
          setError("Network error — try again.");
          setPreview(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, leagueId]);

  async function handleConfirmDelete() {
    if (!leagueId) return;

    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/leagues", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leagueId }),
      });
      const data = (await res.json()) as { error?: string };

      if (!res.ok) {
        setError(data.error ?? "Could not delete league.");
        return;
      }

      onClose();
      router.push("/dashboard?deleted=1");
      router.refresh();
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!open || !leagueId) return null;

  const pickCount = preview?.draftPickCount ?? 0;
  const hasDraftActivity = pickCount > 0;
  const displayName = preview?.leagueName ?? leagueName;
  const displayCode = preview?.supportCode ?? supportCode;

  const modal = (
    <div className="draft-modal-backdrop" onClick={busy ? undefined : onClose}>
      <div
        className="draft-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-league-title"
      >
        <h3 id="delete-league-title" className="draft-modal-title text-red-300">
          Delete league?
        </h3>

        <div className="draft-modal-body space-y-3">
          <div>
            <p className="text-sm text-white font-semibold">{displayName}</p>
            <div className="mt-2">
              <LeagueSupportId code={displayCode} size="md" />
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-muted">Loading league details…</p>
          ) : hasDraftActivity ? (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-sm text-red-200">
              This league has an active draft with{" "}
              <strong>{pickCount}</strong> pick{pickCount === 1 ? "" : "s"} made
              — this cannot be undone. All draft boards, matchups, standings, and
              season data for this league will be permanently removed.
            </div>
          ) : (
            <p className="text-sm text-muted">
              This will permanently delete the league and all associated data for
              every player. This cannot be undone.
            </p>
          )}

          {error ? (
            <p className="text-sm text-red-300">{error}</p>
          ) : null}
        </div>

        <div className="draft-modal-actions">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className="bg-red-600 hover:bg-red-500 border-red-500/50"
            onClick={() => void handleConfirmDelete()}
            disabled={busy || loading}
          >
            {busy ? "Deleting…" : "Delete league"}
          </Button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
