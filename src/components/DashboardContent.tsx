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
import { isDraftCountdownVisible } from "@/lib/league/scheduled-draft";
import { PendingLeagueInviteBanner } from "@/components/league/PendingLeagueInviteBanner";
import { BotSelectionPanel } from "@/components/league/BotSelectionPanel";
import { DeleteLeagueModal } from "@/components/league/DeleteLeagueModal";
import { ContactUsModal } from "@/components/ContactUsModal";
import { CategoryBubbles } from "@/components/league/CategoryBubbles";
import type { BotPersonality } from "@/lib/league/bots";
import { Button } from "@/components/Button";
import { LiveTickerTape } from "@/components/LiveTickerTape";
import type { DayTraderDashboardSummary } from "@/lib/day-trader/dashboard-summary";

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
  const [contactUsOpen, setContactUsOpen] = useState(false);

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

  const squadLeagues = humanLeagues.filter(
    (item) => item.league.format_type !== "sports_league"
  );
  const sportsSimLeagues = humanLeagues.filter(
    (item) => item.league.format_type === "sports_league"
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

      <ContactUsModal
        open={contactUsOpen}
        email={profile.email}
        onClose={() => setContactUsOpen(false)}
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
            <div className="flex items-center gap-3 mt-2">
              <Link
                href="/profile"
                className="text-xs font-semibold text-gold hover:underline"
              >
                Manager Profile
              </Link>
              <Link
                href="/my-account"
                className="text-xs font-semibold text-gold hover:underline"
              >
                My Account
              </Link>
            </div>
          </div>
        </div>
      </section>

      <LiveTickerTape />

      <section className="bg-dark-card border border-gold/30 rounded-2xl p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold mb-1">Create New League</h2>
          <p className="text-muted text-sm">
            Start a Player League with friends, draft a Sports League (SDFL,
            SDHL, SDBA, SDLB), spin up a Free Sim League against three bot
            managers, or jump into Day Trader.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {!showBotSelection && (
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
          <Link href="/leagues/create?entry=player" className="block">
            <Button variant="primary" className="w-full">
              Create Player League
            </Button>
          </Link>
          <div
            style={
              {
                "--color-league-primary": "#dc2626",
                "--color-league-on-primary": "#ffffff",
              } as React.CSSProperties
            }
          >
            <Link href="/leagues/create?entry=sports" className="block">
              <Button variant="primary" className="w-full">
                Create Sports League
              </Button>
            </Link>
          </div>

          <div data-league-theme="day-trader">
            <Link href="/day-trader" className="block">
              <Button variant="primary" className="w-full">
                StockDraft Day Trader
              </Button>
            </Link>
          </div>
          <div data-league-theme="sddfs">
            <Link href="/stockdraft-dfs" className="block">
              <Button variant="primary" className="w-full">
                StockDraft Daily Fantasy Sport
              </Button>
            </Link>
          </div>
        </div>

        {leagueError && !showBotSelection && (
          <p className="text-sm text-red-400">{leagueError}</p>
        )}
        {showBotSelection && (
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
        )}
      </section>

      <section className="bg-dark-card border border-dark-border rounded-2xl p-6 space-y-4">
        <h2 className="text-lg font-semibold">My Leagues</h2>
        <CategoryBubbles
          simLeagueCount={leagues.length}
          playerLeagueCount={squadLeagues.length}
          sportsSimLeagueCount={sportsSimLeagues.length}
          dayTraderActive={Boolean(dayTrader)}
        />
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

      <Button
        variant="ghost"
        onClick={() => setContactUsOpen(true)}
        className="w-full"
      >
        Contact Us
      </Button>

      <Button variant="ghost" onClick={handleSignOut} className="w-full">
        Sign out
      </Button>
    </div>
  );
}
