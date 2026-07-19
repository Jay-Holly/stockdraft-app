"use client";

import Image from "next/image";
import { Button } from "@/components/Button";
import { LeagueSupportId } from "@/components/league/LeagueSupportId";
import { HumanLeagueInvitePanel } from "@/components/league/HumanLeagueInvitePanel";
import { ScheduledDraftCountdown } from "@/components/league/ScheduledDraftCountdown";
import {
  canEnterScheduledDraftRoom,
  draftRoomHref,
  isDraftCountdownVisible,
} from "@/lib/league/scheduled-draft";
import { SPORTS_LEAGUE_FORMATS, leagueThemeIdForSportsLeague } from "@/lib/league/league-config";
import type { HumanLeagueListItem } from "@/lib/league/human-league";

export function leagueStatusLabel(status: string): string {
  if (status === "waiting") return "Waiting for players";
  if (status === "drafting") return "Draft in progress";
  if (status === "active") return "Season active";
  return "Season complete";
}

export function HumanLeagueCard({
  item,
  currentUserId,
  activeLeagueId,
  switchingLeagueId,
  onSelect,
  onDelete,
}: {
  item: HumanLeagueListItem;
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
  const waiting = item.league.status === "waiting";
  const enterDraft = !item.humanDraftComplete;
  const busy = switchingLeagueId === item.league.id;
  const isOwner = item.league.owner_user_id === currentUserId;
  const sportsLeagueLogoSrc = SPORTS_LEAGUE_FORMATS.find(
    (f) => f.id === item.league.sports_league_id
  )?.logoSrc;
  const themeId = leagueThemeIdForSportsLeague(item.league.sports_league_id);

  return (
    <div
      data-league-theme={themeId}
      className={`league-card space-y-3 ${isActive ? "league-card--active" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2">
            <LeagueSupportId code={item.league.support_code} />
          </div>
          <p className="font-semibold truncate">{item.humanTeamName}</p>
          <p className="text-xs text-muted truncate">{item.league.name}</p>
          <p className="text-xs text-muted capitalize mt-1">
            {leagueStatusLabel(item.league.status)} · {item.memberCount}/
            {item.league.player_count} players
            {isActive ? " · selected" : ""}
          </p>
        </div>
        {sportsLeagueLogoSrc && (
          <Image
            src={sportsLeagueLogoSrc}
            alt=""
            width={88}
            height={110}
            className="shrink-0 rounded-lg"
          />
        )}
      </div>

      {waiting && (
        <HumanLeagueInvitePanel
          leagueId={item.league.id}
          leagueName={item.league.name}
          inviteLink={item.inviteLink}
          inviteToken={item.inviteToken}
          isCommissioner={isOwner}
          memberCount={item.memberCount}
          playerCount={item.league.player_count}
          scheduledDraftAt={item.league.scheduled_draft_at}
          compact
        />
      )}

      {waiting && isDraftCountdownVisible(item.league.scheduled_draft_at) && (
        <ScheduledDraftCountdown
          scheduledDraftAt={item.league.scheduled_draft_at}
          leagueId={item.league.id}
          compact
          onEnterDraft={(leagueId, href) => onSelect(leagueId, href)}
        />
      )}

      <div className="flex flex-wrap gap-2">
        {!isActive && (
          <Button
            variant="secondary"
            className="flex-1 text-sm"
            disabled={busy}
            onClick={() => onSelect(item.league.id, "/my-team")}
          >
            My Team
          </Button>
        )}
        {waiting ? (
          canEnterScheduledDraftRoom(item.league.scheduled_draft_at) ? (
            <Button
              variant="primary"
              className="flex-1 text-sm"
              disabled={busy}
              onClick={() =>
                onSelect(item.league.id, draftRoomHref(item.league.id))
              }
            >
              Enter Draft
            </Button>
          ) : (
            <Button
              variant="primary"
              className="flex-1 text-sm"
              onClick={() => onSelect(item.league.id)}
            >
              View invite
            </Button>
          )
        ) : enterDraft ? (
          <Button
            variant="primary"
            className="flex-1 text-sm"
            disabled={busy}
            onClick={() => onSelect(item.league.id, "/draft")}
          >
            Enter draft
          </Button>
        ) : (
          <div className="flex flex-1 gap-2">
            <Button
              variant="primary"
              className="flex-1 text-sm"
              disabled={busy}
              onClick={() => onSelect(item.league.id, "/league")}
            >
              Open league
            </Button>
            <Button
              variant="secondary"
              className="flex-1 text-sm"
              disabled={busy}
              onClick={() => onSelect(item.league.id, "/matchups")}
            >
              Matchups
            </Button>
          </div>
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
