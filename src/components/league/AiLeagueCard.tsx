"use client";

import { Button } from "@/components/Button";
import { LeagueSupportId } from "@/components/league/LeagueSupportId";
import { leagueStatusLabel } from "@/components/league/HumanLeagueCard";
import type { AiLeagueListItem } from "@/lib/league/ai-league";

export function canEnterSeasonLeague(
  status: string,
  humanDraftComplete: boolean
): boolean {
  return humanDraftComplete && status !== "drafting" && status !== "waiting";
}

export function AiLeagueCard({
  item,
  currentUserId,
  activeLeagueId,
  switchingLeagueId,
  onSelect,
  onDelete,
}: {
  item: AiLeagueListItem;
  currentUserId: string;
  activeLeagueId: string | null;
  switchingLeagueId: string | null;
  onSelect: (leagueId: string, navigateTo?: string) => void;
  onDelete?: (league: {
    id: string;
    name: string;
    support_code: string;
    owner_user_id: string | null;
  }) => void;
}) {
  const isActive = item.league.id === activeLeagueId;
  const busy = switchingLeagueId === item.league.id;
  const isOwner = item.league.owner_user_id === currentUserId;

  return (
    <div
      className={`rounded-xl border p-4 space-y-3 ${
        isActive ? "border-gold/50 bg-gold/5" : "border-dark-border bg-dark/20"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2">
            <LeagueSupportId code={item.league.support_code} />
          </div>
          <p className="font-semibold truncate">{item.humanTeamName}</p>
          <p className="text-xs text-muted truncate">{item.league.name}</p>
          <p className="text-xs text-muted capitalize">
            {leagueStatusLabel(item.league.status)}
            {isActive ? " · selected" : ""}
          </p>
          <p className="text-xs text-muted mt-1 truncate">
            vs {item.botNames.join(", ")}
          </p>
        </div>
        {item.standings && (
          <div className="text-right shrink-0">
            <p className="text-xl font-black text-gold">
              {item.standings.wins}-{item.standings.losses}
            </p>
            <p className="text-[10px] text-muted uppercase tracking-wider">W-L</p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {!isActive && (
          <Button
            variant="ghost"
            className="text-xs px-3"
            disabled={busy}
            onClick={() => onSelect(item.league.id)}
          >
            {busy ? "Selecting…" : "Select"}
          </Button>
        )}
        {item.league.status === "drafting" && (
          <Button
            variant="primary"
            className="text-xs px-3"
            disabled={busy}
            onClick={() => onSelect(item.league.id, "/draft")}
          >
            Enter Draft Room
          </Button>
        )}
        {canEnterSeasonLeague(item.league.status, item.humanDraftComplete) && (
          <>
            <Button
              variant="primary"
              className="text-xs px-3"
              disabled={busy}
              onClick={() => onSelect(item.league.id, "/league")}
            >
              Open league
            </Button>
            <Button
              variant="secondary"
              className="text-xs px-3"
              disabled={busy}
              onClick={() => onSelect(item.league.id, "/matchups")}
            >
              Matchups
            </Button>
            <Button
              variant="secondary"
              className="text-xs px-3"
              disabled={busy}
              onClick={() => onSelect(item.league.id, "/my-team")}
            >
              My Team
            </Button>
            <Button
              variant="ghost"
              className="text-xs px-3"
              disabled={busy}
              onClick={() => onSelect(item.league.id, "/free-agents")}
            >
              Free Agents
            </Button>
          </>
        )}
        {isOwner && onDelete && (
          <Button
            variant="ghost"
            className="text-xs px-3 text-red-400 border-red-500/30 hover:border-red-400/50 ml-auto"
            disabled={busy}
            onClick={() => onDelete(item.league)}
          >
            Delete League
          </Button>
        )}
      </div>
    </div>
  );
}
