"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import type { HumanLeagueInvitePreview } from "@/lib/league/human-league";

function formatScheduledDraftAt(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

const inputClass =
  "w-full rounded-xl border border-dark-border bg-dark px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-sm";

type JoinInviteState = {
  preview: HumanLeagueInvitePreview;
  isMember: boolean;
};

export function JoinLeaguePanel({
  token,
  preview: initialPreview,
  defaultTeamName,
  isAuthenticated,
  initialIsMember = false,
}: {
  token: string;
  preview: HumanLeagueInvitePreview;
  defaultTeamName: string;
  isAuthenticated: boolean;
  initialIsMember?: boolean;
}) {
  const router = useRouter();
  const [teamName, setTeamName] = useState(defaultTeamName);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteState, setInviteState] = useState<JoinInviteState>({
    preview: initialPreview,
    isMember: initialIsMember ?? false,
  });

  const refreshInviteState = useCallback(async () => {
    try {
      const res = await fetch(`/api/leagues/join/${token}`);
      const data = await res.json();
      if (!res.ok || !data.preview) return;
      setInviteState({
        preview: data.preview as HumanLeagueInvitePreview,
        isMember: Boolean(data.isMember),
      });
    } catch {
      // Keep the last known invite snapshot if refresh fails.
    }
  }, [token]);

  useEffect(() => {
    void refreshInviteState();
  }, [refreshInviteState]);

  const { preview, isMember } = inviteState;
  const spotsLeft = preview.playerCount - preview.memberCount;
  const isFull = spotsLeft <= 0;
  const leagueStarted =
    preview.status === "drafting" || preview.status === "active";
  // Join eligibility depends only on league status and roster capacity — not whether
  // scheduled_draft_at has passed while the league is still waiting.
  const acceptsJoins = preview.status === "waiting" && !isFull;
  const canJoin = acceptsJoins && !isMember && isAuthenticated;
  const scheduledDraftDate = preview.scheduledDraftAt
    ? new Date(preview.scheduledDraftAt)
    : null;
  const scheduledDraftPassed =
    scheduledDraftDate != null &&
    !Number.isNaN(scheduledDraftDate.getTime()) &&
    scheduledDraftDate.getTime() <= Date.now();
  const canEnterDraft = isMember && leagueStarted;

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!canJoin) return;

    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch(`/api/leagues/join/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not join league.");
        await refreshInviteState();
        return;
      }
      router.push("/draft");
    } catch {
      setError("Network error — try again.");
      await refreshInviteState();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-dark-border bg-dark-card p-5 space-y-3">
        <p className="text-xs uppercase tracking-wider text-gold font-semibold">
          League invite
        </p>
        <h1 className="text-xl font-bold">{preview.leagueName}</h1>
        <p className="text-sm text-muted">
          Hosted by{" "}
          <span className="text-white font-medium">{preview.commissionerTeam}</span>
        </p>
        <p className="text-sm text-muted">
          {spotsLeft > 0
            ? `${spotsLeft} roster spot${spotsLeft === 1 ? "" : "s"} open — `
            : ""}
          {preview.memberCount} of {preview.playerCount} players joined ·{" "}
          {preview.formatType === "standard" ? "Standard" : "Sports League"} ·{" "}
          {preview.opponentType === "all_human" ? "All Human" : preview.opponentType}
        </p>
        {preview.scheduledDraftAt && (
          <p className="text-sm text-muted">
            {acceptsJoins && scheduledDraftPassed ? (
              <>
                Originally scheduled for{" "}
                <span className="text-white font-medium">
                  {formatScheduledDraftAt(preview.scheduledDraftAt)}
                </span>
                {" — "}
                still accepting players until all roster spots are filled.
              </>
            ) : (
              <>
                Scheduled draft:{" "}
                <span className="text-white font-medium">
                  {formatScheduledDraftAt(preview.scheduledDraftAt)}
                </span>
                {preview.opponentType === "all_human"
                  ? " — begins once all roster spots are filled."
                  : null}
              </>
            )}
          </p>
        )}
      </div>

      {canEnterDraft ? (
        <div className="space-y-3">
          <div className="rounded-xl border border-gold/30 bg-gold/5 p-4 text-sm text-muted">
            You&apos;re in this league and the draft has started.
          </div>
          <Button
            variant="primary"
            className="w-full"
            onClick={() => router.push("/draft")}
          >
            Enter draft room
          </Button>
        </div>
      ) : isMember && preview.status === "waiting" ? (
        <div className="space-y-3">
          <div className="rounded-xl border border-dark-border bg-dark/40 p-4 text-sm text-muted">
            You&apos;re already on the roster. Waiting for the league to fill and
            reach the scheduled draft time.
          </div>
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => router.push("/dashboard")}
          >
            Back to dashboard
          </Button>
        </div>
      ) : !canJoin && !isAuthenticated ? (
        acceptsJoins ? (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              Sign in or create an account to join this league.
            </p>
            <Button
              variant="primary"
              className="w-full"
              onClick={() =>
                router.push(
                  `/auth?mode=login&next=${encodeURIComponent(`/leagues/join/${token}`)}`
                )
              }
            >
              Sign in to join
            </Button>
            <Button
              variant="secondary"
              className="w-full"
              onClick={() =>
                router.push(
                  `/auth?mode=signup&next=${encodeURIComponent(`/leagues/join/${token}`)}`
                )
              }
            >
              Create account
            </Button>
          </div>
        ) : (
          <div className="rounded-xl border border-dark-border bg-dark/40 p-4 text-sm text-muted">
            {isFull
              ? "This league is full."
              : leagueStarted
                ? "This league has already started drafting."
                : "This league is no longer accepting players."}
          </div>
        )
      ) : canJoin ? (
        <form onSubmit={handleJoin} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold mb-1.5" htmlFor="teamName">
              Your team name
            </label>
            <input
              id="teamName"
              className={inputClass}
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              maxLength={40}
              required
            />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button
            type="submit"
            variant="primary"
            className="w-full"
            disabled={submitting}
          >
            {submitting ? "Joining…" : "Join league & enter draft"}
          </Button>
        </form>
      ) : (
        <div className="rounded-xl border border-dark-border bg-dark/40 p-4 text-sm text-muted">
          {isFull
            ? "This league is full."
            : leagueStarted
              ? "This league has already started drafting."
              : "This league is no longer accepting players."}
        </div>
      )}
    </div>
  );
}
