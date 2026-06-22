"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";

export function HumanLeagueInvitePanel({
  leagueId,
  inviteLink,
  isCommissioner,
  compact = false,
}: {
  leagueId: string;
  inviteLink: string | null;
  isCommissioner: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"cancel" | "regenerate" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runInviteAction(action: "cancel" | "regenerate") {
    setBusy(action);
    setError(null);

    try {
      const res = await fetch("/api/leagues/human/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leagueId, action }),
      });
      const data = (await res.json()) as { error?: string };

      if (!res.ok) {
        setError(data.error ?? "Could not update invite.");
        return;
      }

      router.refresh();
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(null);
    }
  }

  function copyLink() {
    if (!inviteLink) return;
    void navigator.clipboard.writeText(inviteLink);
  }

  if (!isCommissioner && !inviteLink) {
    return null;
  }

  return (
    <div
      className={`rounded-lg border border-dark-border bg-dark space-y-3 ${
        compact ? "p-3" : "p-4"
      }`}
    >
      {inviteLink ? (
        <>
          <p className="text-xs text-muted">
            Share this invite link with your opponent:
          </p>
          <p className="text-[0.6875rem] text-gold break-all font-mono">
            {inviteLink}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="secondary"
              className="flex-1 text-sm"
              onClick={copyLink}
            >
              Copy link
            </Button>
            {isCommissioner && (
              <Button
                variant="secondary"
                className="flex-1 text-sm text-red-300 border-red-500/30 hover:border-red-400/50"
                disabled={busy !== null}
                onClick={() => void runInviteAction("cancel")}
              >
                {busy === "cancel" ? "Cancelling…" : "Cancel invite"}
              </Button>
            )}
          </div>
        </>
      ) : isCommissioner ? (
        <>
          <p className="text-xs text-muted">
            The previous invite link was cancelled and no longer works.
          </p>
          <Button
            variant="primary"
            className="w-full text-sm"
            disabled={busy !== null}
            onClick={() => void runInviteAction("regenerate")}
          >
            {busy === "regenerate" ? "Generating…" : "Generate new invite link"}
          </Button>
        </>
      ) : null}

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
