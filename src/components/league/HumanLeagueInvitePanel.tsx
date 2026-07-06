"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { buildInviteLinkPath } from "@/lib/app-url";

function formatScheduledDraftAt(iso: string | null | undefined): string | null {
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

export function HumanLeagueInvitePanel({
  leagueId,
  leagueName,
  inviteLink,
  inviteToken,
  isCommissioner,
  memberCount,
  playerCount,
  scheduledDraftAt,
  compact = false,
}: {
  leagueId: string;
  leagueName?: string;
  inviteLink: string | null;
  inviteToken?: string | null;
  isCommissioner: boolean;
  memberCount?: number;
  playerCount?: number;
  scheduledDraftAt?: string | null;
  compact?: boolean;
}) {
  const router = useRouter();
  const [shareLink, setShareLink] = useState(inviteLink);
  const resolvedInviteToken = useMemo(() => {
    if (inviteToken) return inviteToken;
    if (!inviteLink) return null;
    const match = inviteLink.match(
      /\/leagues\/join\/([0-9a-f-]{36})/i
    );
    return match?.[1] ?? null;
  }, [inviteToken, inviteLink]);

  useEffect(() => {
    if (!resolvedInviteToken || typeof window === "undefined") {
      setShareLink(inviteLink);
      return;
    }
    setShareLink(`${window.location.origin}${buildInviteLinkPath(resolvedInviteToken)}`);
  }, [resolvedInviteToken, inviteLink]);
  const [busy, setBusy] = useState<"cancel" | "regenerate" | "delete" | null>(
    null
  );
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

  async function handleCancelInviteLink() {
    const confirmed = window.confirm(
      "Cancel this invite link? The league stays on your dashboard — only the current link stops working. You can generate a new link afterward."
    );
    if (!confirmed) return;
    await runInviteAction("cancel");
  }

  async function handleDeleteLeague() {
    const label = leagueName ? `"${leagueName}"` : "this league";
    const confirmed = window.confirm(
      `Permanently delete ${label}? This removes the league, draft setup, and invite for all players. This cannot be undone.`
    );
    if (!confirmed) return;

    setBusy("delete");
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

      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(null);
    }
  }

  function copyLink() {
    if (!shareLink) return;
    void navigator.clipboard.writeText(shareLink);
  }

  const spotsOpen =
    memberCount != null && playerCount != null
      ? Math.max(playerCount - memberCount, 0)
      : null;
  const isFull = spotsOpen === 0 && playerCount != null;
  const formattedDraftTime = formatScheduledDraftAt(scheduledDraftAt);

  if (!isCommissioner && !shareLink) {
    return null;
  }

  return (
    <div
      className={`rounded-lg border border-dark-border bg-dark space-y-3 ${
        compact ? "p-3" : "p-4"
      }`}
    >
      {shareLink ? (
        <>
          <p className="text-xs text-muted">
            {isFull ? (
              <>
                All {playerCount} players have joined! The live draft begins
                {formattedDraftTime ? (
                  <>
                    {" "}
                    <span className="text-white font-medium">
                      {formattedDraftTime}
                    </span>
                  </>
                ) : (
                  " soon"
                )}
                . Make sure everyone is online and ready.
              </>
            ) : spotsOpen != null && playerCount != null ? (
              <>
                Share this invite link — {spotsOpen} of {playerCount} roster spot
                {spotsOpen === 1 ? "" : "s"} open. Anyone with the link can join
                until the league is full.
              </>
            ) : (
              <>
                Share this invite link with friends. Anyone with the link can join
                until all roster spots are filled.
              </>
            )}
          </p>
          <p className="text-[0.6875rem] text-gold break-all font-mono">
            {shareLink}
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
                className="flex-1 text-sm"
                disabled={busy !== null}
                onClick={() => void handleCancelInviteLink()}
              >
                {busy === "cancel" ? "Cancelling…" : "Cancel invite link"}
              </Button>
            )}
          </div>
        </>
      ) : isCommissioner ? (
        <>
          <p className="text-xs text-muted">
            The previous invite link was cancelled. The league is still waiting
            for players — generate a new link when you&apos;re ready.
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

      {isCommissioner && (
        <div className="pt-2 border-t border-dark-border">
          <Button
            variant="ghost"
            className="w-full text-sm text-red-400 border border-red-500/30 hover:border-red-400/50"
            disabled={busy !== null}
            onClick={() => void handleDeleteLeague()}
          >
            {busy === "delete" ? "Deleting…" : "Delete league"}
          </Button>
          <p className="text-[0.6875rem] text-muted mt-2">
            Deletes the entire league permanently. Use &ldquo;Cancel invite
            link&rdquo; above if you only want to invalidate the current URL.
          </p>
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
