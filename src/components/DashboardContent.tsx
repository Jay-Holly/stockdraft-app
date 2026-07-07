"use client";

import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  getAvatarHex,
  type Profile,
} from "@/lib/types";
import type {
  AiLeagueListItem,
  AiLeagueSummary,
} from "@/lib/league/ai-league";
import type { HumanLeagueListItem, PendingHumanLeagueInvite } from "@/lib/league/human-league";
import { HumanLeagueInvitePanel } from "@/components/league/HumanLeagueInvitePanel";
import { ScheduledDraftCountdown } from "@/components/league/ScheduledDraftCountdown";
import {
  canEnterScheduledDraftRoom,
  draftRoomHref,
  isDraftCountdownVisible,
} from "@/lib/league/scheduled-draft";
import { PendingLeagueInviteBanner } from "@/components/league/PendingLeagueInviteBanner";
import { DayTraderDashboardCard } from "@/components/day-trader/DayTraderDashboardCard";
import { BotSelectionPanel } from "@/components/league/BotSelectionPanel";
import { LeagueSupportId } from "@/components/league/LeagueSupportId";
import { DeleteLeagueModal } from "@/components/league/DeleteLeagueModal";
import type { BotPersonality } from "@/lib/league/bots";
import { Button } from "@/components/Button";
import { LiveTickerTape } from "@/components/LiveTickerTape";
import {
  formatMatchupScore,
  parseLeagueScoringMode,
  type LeagueScoringMode,
} from "@/lib/league/scoring-mode";
import type { DayTraderDashboardSummary } from "@/lib/day-trader/dashboard-summary";

function leagueStatusLabel(status: string): string {
  if (status === "waiting") return "Waiting for players";
  if (status === "drafting") return "Draft in progress";
  if (status === "active") return "Season active";
  return "Season complete";
}

function canEnterSeasonLeague(
  status: string,
  humanDraftComplete: boolean
): boolean {
  return (
    humanDraftComplete && status !== "drafting" && status !== "waiting"
  );
}

function MatchupResultCard({
  weekNumber,
  opponentName,
  humanScore,
  opponentScore,
  scoringMode,
  winner,
  upcoming = false,
}: {
  weekNumber: number;
  opponentName: string;
  humanScore: number | null;
  opponentScore: number | null;
  scoringMode: LeagueScoringMode;
  winner: string | null;
  upcoming?: boolean;
}) {
  return (
    <div className="rounded-xl border border-dark-border p-4">
      <p className="text-xs text-muted uppercase tracking-wider mb-2">
        Week {weekNumber} {upcoming ? "matchup" : "result"}
      </p>
      <p className="text-sm mb-3">
        vs <span className="font-semibold text-white">{opponentName}</span>
      </p>

      {upcoming ? (
        <p className="text-sm text-muted">
          Scores on your next dashboard visit using{" "}
          {scoringMode === "dollar_gain"
            ? "weekly dollar gain on starters + crypto (bench excluded)."
            : "weekly percentage gain on starters + crypto (bench excluded)."}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-dark px-3 py-2">
              <p className="text-muted text-xs">You</p>
              <p
                className={`font-bold ${
                  winner === "human"
                    ? "text-green-400"
                    : winner === "tie"
                      ? "text-gold"
                      : "text-white"
                }`}
              >
                {formatMatchupScore(humanScore, scoringMode)}
              </p>
            </div>
            <div className="rounded-lg bg-dark px-3 py-2">
              <p className="text-muted text-xs">Opponent</p>
              <p
                className={`font-bold ${
                  winner === "opponent"
                    ? "text-green-400"
                    : winner === "tie"
                      ? "text-gold"
                      : "text-white"
                }`}
              >
                {formatMatchupScore(opponentScore, scoringMode)}
              </p>
            </div>
          </div>
          {winner && (
            <p className="text-sm mt-3 font-medium">
              {winner === "human"
                ? "You won this week!"
                : winner === "opponent"
                  ? `${opponentName} won this week.`
                  : "This week was a tie."}
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function DashboardContent({
  profile,
  leagues = [],
  humanLeagues = [],
  activeHumanLeague = null,
  activeLeagueId = null,
  activeSummary = null,
  scoringNotice = null,
  pendingInvites = [],
  dayTrader,
}: {
  profile: Profile;
  leagues?: AiLeagueListItem[];
  humanLeagues?: HumanLeagueListItem[];
  activeHumanLeague?: HumanLeagueListItem | null;
  activeLeagueId?: string | null;
  activeSummary?: AiLeagueSummary | null;
  scoringNotice?: string | null;
  pendingInvites?: PendingHumanLeagueInvite[];
  dayTrader?: DayTraderDashboardSummary;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [startingLeague, setStartingLeague] = useState(false);
  const [switchingLeagueId, setSwitchingLeagueId] = useState<string | null>(
    null
  );
  const [deleteTarget, setDeleteTarget] = useState<{
    leagueId: string;
    leagueName: string;
    supportCode: string;
  } | null>(null);
  const [showBotSelection, setShowBotSelection] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [leagueError, setLeagueError] = useState<string | null>(null);

  useEffect(() => {
    if (searchParams.get("deleted") !== "1") return;
    setMessage("League deleted.");
    const url = new URL(window.location.href);
    url.searchParams.delete("deleted");
    router.replace(url.pathname + url.search);
  }, [router, searchParams]);

  const supabase = createClient();
  const avatarHex = getAvatarHex(profile.avatar_color);
  const initials = profile.username.slice(0, 2).toUpperCase();

  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  async function setActiveLeague(leagueId: string, navigateTo?: string) {
    setSwitchingLeagueId(leagueId);
    try {
      const res = await fetch("/api/leagues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leagueId }),
      });
      if (!res.ok) {
        const data = await res.json();
        setLeagueError(data.error ?? "Could not switch league");
        return;
      }
      if (navigateTo) {
        router.push(navigateTo);
      } else {
        router.refresh();
      }
    } finally {
      setSwitchingLeagueId(null);
    }
  }

  async function handleCreateLeague(
    botPersonalities: BotPersonality[],
    leagueTeamName: string
  ) {
    setStartingLeague(true);
    setLeagueError(null);

    try {
      const response = await fetch("/api/leagues/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botPersonalities, teamName: leagueTeamName }),
      });
      const data = await response.json();

      if (!response.ok) {
        setLeagueError(data.error ?? "Could not create league");
        return;
      }

      setShowBotSelection(false);
      router.push("/draft");
      router.refresh();
    } finally {
      setStartingLeague(false);
    }
  }

  const createdDate = new Date(profile.created_at).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  function openDeleteLeagueModal(league: {
    id: string;
    name: string;
    support_code: string;
  }) {
    setDeleteTarget({
      leagueId: league.id,
      leagueName: league.name,
      supportCode: league.support_code,
    });
  }

  function renderOwnerDeleteButton(
    league: { id: string; name: string; support_code: string; owner_user_id: string | null },
    busy: boolean
  ) {
    if (league.owner_user_id !== profile.id) return null;

    return (
      <Button
        variant="ghost"
        className="text-xs px-3 text-red-400 border-red-500/30 hover:border-red-400/50 ml-auto"
        disabled={busy}
        onClick={() => openDeleteLeagueModal(league)}
      >
        Delete League
      </Button>
    );
  }

  const activeLeagueItem = leagues.find(
    (item) => item.league.id === activeLeagueId
  );

  return (
    <div className="space-y-6">
      <DeleteLeagueModal
        open={deleteTarget != null}
        leagueId={deleteTarget?.leagueId ?? null}
        leagueName={deleteTarget?.leagueName ?? ""}
        supportCode={deleteTarget?.supportCode ?? ""}
        onClose={() => setDeleteTarget(null)}
      />

      {message && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {message}
        </div>
      )}

      {scoringNotice && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          {scoringNotice}
        </div>
      )}

      {pendingInvites.length > 0 && (
        <PendingLeagueInviteBanner invites={pendingInvites} />
      )}

      <section className="bg-dark-card border border-dark-border rounded-2xl p-6">
        <div className="flex items-center gap-4">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center text-xl font-black text-white shrink-0"
            style={{ backgroundColor: avatarHex }}
          >
            {initials}
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold truncate">{profile.team_name}</h1>
            <p className="text-muted text-sm truncate">@{profile.username}</p>
            <p className="text-muted text-xs mt-1">Member since {createdDate}</p>
            <Link
              href="/profile"
              className="inline-block text-xs font-semibold text-gold hover:underline mt-2"
            >
              Manager Profile
            </Link>
          </div>
        </div>
      </section>

      <LiveTickerTape />

      {dayTrader ? <DayTraderDashboardCard summary={dayTrader} /> : null}

      <section className="bg-dark-card border border-gold/30 rounded-2xl p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold mb-1">Create New League</h2>
          <p className="text-muted text-sm">
            Start a Squad League with friends, or spin up a Free Sim League against
            three bot managers.
          </p>
        </div>

        <Link href="/leagues/create" className="block">
          <Button variant="primary" className="w-full">
            Create Squad League
          </Button>
        </Link>

        {leagueError && !showBotSelection && (
          <p className="text-sm text-red-400">{leagueError}</p>
        )}
        {showBotSelection ? (
          <BotSelectionPanel
            defaultTeamName={profile.team_name}
            onCancel={() => {
              setShowBotSelection(false);
              setLeagueError(null);
            }}
            onConfirm={handleCreateLeague}
            confirming={startingLeague}
            error={leagueError}
          />
        ) : (
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => {
              setLeagueError(null);
              setShowBotSelection(true);
            }}
          >
            Create Free Sim League
          </Button>
        )}
      </section>

      {leagues.length > 0 && (
        <section className="bg-dark-card border border-dark-border rounded-2xl p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Free Sim Leagues</h2>
            <p className="text-muted text-sm">
              {leagues.length} league{leagues.length === 1 ? "" : "s"} · select
              one to play
            </p>
          </div>

          {leagues.map((item) => {
            const isActive = item.league.id === activeLeagueId;
            const busy = switchingLeagueId === item.league.id;

            return (
              <div
                key={item.league.id}
                className={`rounded-xl border p-4 space-y-3 ${
                  isActive
                    ? "border-gold/50 bg-gold/5"
                    : "border-dark-border bg-dark/20"
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
                      <p className="text-[10px] text-muted uppercase tracking-wider">
                        W-L
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  {!isActive && (
                    <Button
                      variant="ghost"
                      className="text-xs px-3"
                      disabled={busy}
                      onClick={() => void setActiveLeague(item.league.id)}
                    >
                      {busy ? "Selecting…" : "Select"}
                    </Button>
                  )}
                  {item.league.status === "drafting" && (
                    <Button
                      variant="primary"
                      className="text-xs px-3"
                      disabled={busy}
                      onClick={() =>
                        void setActiveLeague(item.league.id, "/draft")
                      }
                    >
                      Enter Draft Room
                    </Button>
                  )}
                  {canEnterSeasonLeague(
                    item.league.status,
                    item.humanDraftComplete
                  ) && (
                    <>
                      <Button
                        variant="primary"
                        className="text-xs px-3"
                        disabled={busy}
                        onClick={() =>
                          void setActiveLeague(item.league.id, "/league")
                        }
                      >
                        Open league
                      </Button>
                      <Button
                        variant="secondary"
                        className="text-xs px-3"
                        disabled={busy}
                        onClick={() =>
                          void setActiveLeague(item.league.id, "/matchups")
                        }
                      >
                        Matchups
                      </Button>
                      <Button
                        variant="secondary"
                        className="text-xs px-3"
                        disabled={busy}
                        onClick={() =>
                          void setActiveLeague(item.league.id, "/my-team")
                        }
                      >
                        My Team
                      </Button>
                      <Button
                        variant="ghost"
                        className="text-xs px-3"
                        disabled={busy}
                        onClick={() =>
                          void setActiveLeague(item.league.id, "/free-agents")
                        }
                      >
                        Free Agents
                      </Button>
                    </>
                  )}
                  {renderOwnerDeleteButton(item.league, busy)}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {humanLeagues.length > 0 && (
        <section className="bg-dark-card border border-dark-border rounded-2xl p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Squad Leagues</h2>
            <p className="text-muted text-sm">
              {humanLeagues.length} league{humanLeagues.length === 1 ? "" : "s"}
            </p>
          </div>

          {humanLeagues.map((item) => {
            const isActive = item.league.id === activeLeagueId;
            const waiting = item.league.status === "waiting";
            const enterDraft = !item.humanDraftComplete;
            const busy = switchingLeagueId === item.league.id;
            const isOwner = item.league.owner_user_id === profile.id;

            return (
              <div
                key={item.league.id}
                className={`rounded-xl border p-4 space-y-3 ${
                  isActive
                    ? "border-gold/50 bg-gold/5"
                    : "border-dark-border bg-dark/20"
                }`}
              >
                <div>
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
                    onEnterDraft={(leagueId, href) =>
                      void setActiveLeague(leagueId, href)
                    }
                  />
                )}

                <div className="flex flex-wrap gap-2">
                  {!isActive && (
                    <Button
                      variant="secondary"
                      className="flex-1 text-sm"
                      disabled={busy}
                      onClick={() => void setActiveLeague(item.league.id)}
                    >
                      Select
                    </Button>
                  )}
                  {waiting ? (
                    canEnterScheduledDraftRoom(item.league.scheduled_draft_at) ? (
                      <Button
                        variant="primary"
                        className="flex-1 text-sm"
                        disabled={switchingLeagueId === item.league.id}
                        onClick={() =>
                          void setActiveLeague(
                            item.league.id,
                            draftRoomHref(item.league.id)
                          )
                        }
                      >
                        Enter Draft
                      </Button>
                    ) : (
                      <Button
                        variant="primary"
                        className="flex-1 text-sm"
                        onClick={() => void setActiveLeague(item.league.id)}
                      >
                        View invite
                      </Button>
                    )
                  ) : enterDraft ? (
                    <Button
                      variant="primary"
                      className="flex-1 text-sm"
                      disabled={switchingLeagueId === item.league.id}
                      onClick={() =>
                        void setActiveLeague(item.league.id, "/draft")
                      }
                    >
                      Enter draft
                    </Button>
                  ) : (
                    <div className="flex flex-1 gap-2">
                      <Button
                        variant="primary"
                        className="flex-1 text-sm"
                        disabled={switchingLeagueId === item.league.id}
                        onClick={() =>
                          void setActiveLeague(item.league.id, "/league")
                        }
                      >
                        Open league
                      </Button>
                      <Button
                        variant="secondary"
                        className="flex-1 text-sm"
                        disabled={switchingLeagueId === item.league.id}
                        onClick={() =>
                          void setActiveLeague(item.league.id, "/matchups")
                        }
                      >
                        Matchups
                      </Button>
                    </div>
                  )}
                  {renderOwnerDeleteButton(item.league, busy)}
                </div>
              </div>
            );
          })}
        </section>
      )}

      <section className="bg-dark-card border border-dark-border/80 rounded-2xl p-6">
        <h2 className="text-lg font-semibold mb-1">Sports Sim Leagues</h2>
        <p className="text-muted text-sm">
          Draft real players&apos; stocks — injuries and all. Coming soon.
        </p>
      </section>

      {activeHumanLeague?.league.status === "waiting" &&
        activeHumanLeague.league.owner_user_id === profile.id && (
        <section className="bg-dark-card border border-amber-500/30 rounded-2xl p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold mb-2">Waiting for players</h2>
            <p className="text-sm text-muted">
              {activeHumanLeague.memberCount >= activeHumanLeague.league.player_count ? (
                <>
                  Your league{" "}
                  <span className="text-white font-medium">
                    {activeHumanLeague.league.name}
                  </span>{" "}
                  is full — all {activeHumanLeague.league.player_count} players have
                  joined. Share the details below with your league and make sure
                  everyone is online and ready for the live draft
                  {activeHumanLeague.league.scheduled_draft_at
                    ? ` at ${new Date(
                        activeHumanLeague.league.scheduled_draft_at
                      ).toLocaleString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                        timeZoneName: "short",
                      })}`
                    : ""}
                  .
                </>
              ) : (
                <>
                  Your league{" "}
                  <span className="text-white font-medium">
                    {activeHumanLeague.league.name}
                  </span>{" "}
                  needs all {activeHumanLeague.league.player_count} roster spots
                  filled before the live draft can begin
                  {activeHumanLeague.league.scheduled_draft_at
                    ? ` at ${new Date(
                        activeHumanLeague.league.scheduled_draft_at
                      ).toLocaleString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                        timeZoneName: "short",
                      })}`
                    : ""}
                  . Share your invite link below.
                </>
              )}
            </p>
          </div>
          <HumanLeagueInvitePanel
            leagueId={activeHumanLeague.league.id}
            leagueName={activeHumanLeague.league.name}
            inviteLink={activeHumanLeague.inviteLink}
            inviteToken={activeHumanLeague.inviteToken}
            memberCount={activeHumanLeague.memberCount}
            playerCount={activeHumanLeague.league.player_count}
            scheduledDraftAt={activeHumanLeague.league.scheduled_draft_at}
            isCommissioner
          />
          {isDraftCountdownVisible(activeHumanLeague.league.scheduled_draft_at) && (
            <ScheduledDraftCountdown
              scheduledDraftAt={activeHumanLeague.league.scheduled_draft_at}
              leagueId={activeHumanLeague.league.id}
              onEnterDraft={(leagueId, href) =>
                void setActiveLeague(leagueId, href)
              }
            />
          )}
        </section>
      )}

      {activeSummary && activeSummary.league.id === activeLeagueId && (
        <section className="bg-dark-card border border-dark-border rounded-2xl p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="mb-2">
                <LeagueSupportId code={activeSummary.league.support_code} size="md" />
              </div>
              <h2 className="text-lg font-semibold">
                {activeLeagueItem?.humanTeamName ?? profile.team_name}
              </h2>
              <p className="text-muted text-sm">{activeSummary.league.name}</p>
              <p className="text-muted text-xs capitalize mt-1">
                {leagueStatusLabel(activeSummary.league.status)}
              </p>
            </div>
            {activeSummary.standings && (
              <div className="text-right shrink-0">
                <p className="text-2xl font-black text-gold">
                  {activeSummary.standings.wins}-{activeSummary.standings.losses}
                </p>
                <p className="text-xs text-muted uppercase tracking-wider">
                  W-L record
                </p>
              </div>
            )}
          </div>

          {activeSummary.league.status === "drafting" &&
            !activeSummary.humanDraftComplete && (
              <Button href="/draft" variant="primary" className="w-full">
                Continue live draft
              </Button>
            )}

          {canEnterSeasonLeague(
            activeSummary.league.status,
            activeSummary.humanDraftComplete
          ) && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                className="flex-1 text-sm"
                disabled={switchingLeagueId === activeSummary.league.id}
                onClick={() =>
                  void setActiveLeague(activeSummary.league.id, "/league")
                }
              >
                Open league
              </Button>
              <Button
                variant="secondary"
                className="flex-1 text-sm"
                disabled={switchingLeagueId === activeSummary.league.id}
                onClick={() =>
                  void setActiveLeague(activeSummary.league.id, "/matchups")
                }
              >
                Matchups
              </Button>
              <Button
                variant="secondary"
                className="flex-1 text-sm"
                disabled={switchingLeagueId === activeSummary.league.id}
                onClick={() =>
                  void setActiveLeague(activeSummary.league.id, "/my-team")
                }
              >
                My Team
              </Button>
              <Button
                variant="ghost"
                className="flex-1 text-sm"
                disabled={switchingLeagueId === activeSummary.league.id}
                onClick={() =>
                  void setActiveLeague(activeSummary.league.id, "/free-agents")
                }
              >
                Free Agents
              </Button>
            </div>
          )}

          {activeSummary.lastCompletedMatchup &&
            activeSummary.league.status !== "drafting" && (
              <MatchupResultCard
                weekNumber={activeSummary.lastCompletedMatchup.weekNumber}
                opponentName={activeSummary.lastCompletedMatchup.opponentName}
                humanScore={activeSummary.lastCompletedMatchup.humanScorePct}
                opponentScore={
                  activeSummary.lastCompletedMatchup.opponentScorePct
                }
                scoringMode={parseLeagueScoringMode(
                  activeSummary.league.scoring_mode
                )}
                winner={activeSummary.lastCompletedMatchup.winner}
              />
            )}

          {activeSummary.currentMatchup &&
            activeSummary.league.status !== "drafting" &&
            activeSummary.currentMatchup.status === "scheduled" && (
              <MatchupResultCard
                weekNumber={activeSummary.currentMatchup.weekNumber}
                opponentName={activeSummary.currentMatchup.opponentName}
                humanScore={null}
                opponentScore={null}
                scoringMode={parseLeagueScoringMode(
                  activeSummary.league.scoring_mode
                )}
                winner={null}
                upcoming
              />
            )}
          {renderOwnerDeleteButton(
            activeSummary.league,
            switchingLeagueId === activeSummary.league.id
          )}
        </section>
      )}

      <Button variant="ghost" onClick={handleSignOut} className="w-full">
        Sign out
      </Button>
    </div>
  );
}
