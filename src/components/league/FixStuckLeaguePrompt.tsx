"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { STANDARD_PLAYER_COUNTS } from "@/lib/league/league-config";

function nearestFitCount(memberCount: number): number {
  const fit = [...STANDARD_PLAYER_COUNTS]
    .filter((n) => n >= memberCount)
    .sort((a, b) => a - b)[0];
  return fit ?? STANDARD_PLAYER_COUNTS[STANDARD_PLAYER_COUNTS.length - 1];
}

type Member = { id: string; displayName: string | null };

export function FixStuckLeaguePrompt({
  leagueId,
  memberCount,
  playerCount,
}: {
  leagueId: string;
  memberCount: number;
  playerCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRemove, setShowRemove] = useState(false);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [loadingMembers, setLoadingMembers] = useState(false);

  const isEven = memberCount % 2 === 0;
  const target = nearestFitCount(memberCount);

  async function patch(action: "allow_bots" | "shrink_to_fit" | "remove_member", memberId?: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/leagues/${leagueId}/fix-signups`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(memberId ? { action, memberId } : { action }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not update the league.");
        return;
      }
      router.refresh();
      setShowRemove(false);
      setMembers(null);
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function loadMembers() {
    setLoadingMembers(true);
    setError(null);
    try {
      const res = await fetch(`/api/leagues/${leagueId}/fix-signups`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not load players.");
        return;
      }
      setMembers(data.members ?? []);
    } catch {
      setError("Network error — try again.");
    } finally {
      setLoadingMembers(false);
    }
  }

  return (
    <div className="space-y-2 rounded-xl border border-gold/30 bg-gold/5 px-4 py-3">
      <p className="text-sm text-white">
        Only <span className="font-semibold">{memberCount}</span> of{" "}
        <span className="font-semibold">{playerCount}</span> people have joined and
        the draft starts soon. Add bots to fill the rest, or shrink the league to
        match who&apos;s actually signed up.
      </p>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="primary"
          className="text-sm"
          disabled={busy}
          onClick={() => void patch("allow_bots")}
        >
          {busy ? "Working…" : "Fill with bots"}
        </Button>
        {isEven ? (
          <Button
            type="button"
            variant="secondary"
            className="text-sm"
            disabled={busy}
            onClick={() => void patch("shrink_to_fit")}
          >
            Shrink to {target} teams
          </Button>
        ) : (
          <Button
            type="button"
            variant="secondary"
            className="text-sm"
            disabled={busy || loadingMembers}
            onClick={() => {
              if (!showRemove) void loadMembers();
              setShowRemove((v) => !v);
            }}
          >
            {loadingMembers ? "Loading…" : "Odd number of players — remove one"}
          </Button>
        )}
      </div>
      {!isEven && showRemove && members && (
        <div className="space-y-1 rounded-lg border border-dark-border bg-dark/40 px-3 py-2">
          {members.length === 0 ? (
            <p className="text-xs text-muted">No players to remove.</p>
          ) : (
            members.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-2">
                <span className="text-sm text-white">{m.displayName ?? "Unnamed"}</span>
                <Button
                  type="button"
                  variant="ghost"
                  className="text-xs px-3 text-red-400 border-red-500/30 hover:border-red-400/50"
                  disabled={busy}
                  onClick={() => void patch("remove_member", m.id)}
                >
                  Remove
                </Button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
