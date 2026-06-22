"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import type { HumanLeagueInvitePreview } from "@/lib/league/human-league";

const inputClass =
  "w-full rounded-xl border border-dark-border bg-dark px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-sm";

export function JoinLeaguePanel({
  token,
  preview,
  defaultTeamName,
  isAuthenticated,
}: {
  token: string;
  preview: HumanLeagueInvitePreview;
  defaultTeamName: string;
  isAuthenticated: boolean;
}) {
  const router = useRouter();
  const [teamName, setTeamName] = useState(defaultTeamName);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const spotsLeft = preview.playerCount - preview.memberCount;
  const isFull = spotsLeft <= 0;
  const isOpen = preview.status === "waiting" && !isFull;

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
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
        return;
      }
      router.push("/draft");
    } catch {
      setError("Network error — try again.");
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
          {preview.memberCount} of {preview.playerCount} players joined ·{" "}
          {preview.formatType === "standard" ? "Standard" : "Sports League"} ·{" "}
          {preview.opponentType === "all_human" ? "All Human" : preview.opponentType}
        </p>
      </div>

      {!isOpen ? (
        <div className="rounded-xl border border-dark-border bg-dark/40 p-4 text-sm text-muted">
          {isFull
            ? "This league is full."
            : preview.status === "drafting"
              ? "This league has already started drafting."
              : "This league is no longer accepting players."}
        </div>
      ) : !isAuthenticated ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Sign in or create an account to join as player 2.
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
      )}
    </div>
  );
}
