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
import type { BotPersonality } from "@/lib/league/bots";
import { Button } from "@/components/Button";
import { LiveTickerTape } from "@/components/LiveTickerTape";
import type { DayTraderDashboardSummary } from "@/lib/day-trader/dashboard-summary";
import Image from "next/image";

type TileIcon = "chart" | "diamond" | "trophy" | "bolt" | "calendarDay" | "calendarWeek";

const TILE_ICON_PATHS: Record<TileIcon, React.ReactNode> = {
  chart: (
    <path d="M3 17l5-5 4 4 8-8M20 8V4h-4" strokeLinecap="round" strokeLinejoin="round" />
  ),
  diamond: (
    <path d="M6 3h12l3 6-9 12L3 9l3-6z" strokeLinecap="round" strokeLinejoin="round" />
  ),
  trophy: (
    <path
      d="M8 4h8v4a4 4 0 01-8 0V4zM8 4H4v2a4 4 0 004 4M16 4h4v2a4 4 0 01-4 4M12 12v4m-3 4h6m-3 0v-4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  bolt: <path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" strokeLinecap="round" strokeLinejoin="round" />,
  calendarDay: (
    <path
      d="M7 3v3M17 3v3M4 9h16M5 6h14a1 1 0 011 1v12a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  calendarWeek: (
    <path
      d="M7 3v3M17 3v3M4 9h16M5 6h14a1 1 0 011 1v12a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1zM8 13h2M14 13h2M8 17h2M14 17h2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
};

function TileIconGlyph({ icon }: { icon: TileIcon }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className="w-5 h-5 shrink-0"
      aria-hidden="true"
    >
      {TILE_ICON_PATHS[icon]}
    </svg>
  );
}

function TileLabel({ icon, children }: { icon: TileIcon; children: React.ReactNode }) {
  return (
    <span className="flex items-center justify-center gap-2">
      <TileIconGlyph icon={icon} />
      <span>{children}</span>
    </span>
  );
}

const TILE_BUTTON_CLASS =
  "w-full sm:w-full !text-white h-14 text-center leading-tight border border-black/25 shadow-[0_2px_0_0_rgba(0,0,0,0.35)]";

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

      <section className="crest-card p-6">
        <div className="flex items-center gap-4">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center text-xl font-black text-white shrink-0 border border-gold/40"
            style={{ backgroundColor: avatarHex }}
          >
            {initials}
          </div>
          <div className="min-w-0 flex-1">
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
                My Wallet
              </Link>
            </div>
          </div>
          <Image
            src="/images/brand/sdlogo.png"
            alt="StockDraft"
            width={140}
            height={210}
            className="h-44 w-auto shrink-0 -my-12 drop-shadow-[0_0_28px_rgba(208,171,72,0.5)]"
            priority
          />
        </div>
      </section>

      <LiveTickerTape />

      <section className="crest-card p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold mb-1 text-gold">Create New League</h2>
          <p className="text-muted text-sm">
            Free Sim League to practice against bots, Player League with
            friends, Sports League draft, Day Trader for prizes, our
            ultimate game of skill the Daily/Weekly Fantasy Sport contests
            to wager a flat fee for a shot at the pot. Private and Public
            leagues we have it all!
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {!showBotSelection && (
            <Button
              variant="secondary"
              className={TILE_BUTTON_CLASS}
              onClick={() => {
                setLeagueError(null);
                setShowBotSelection(true);
              }}
            >
              <TileLabel icon="chart">Create Free Sim League</TileLabel>
            </Button>
          )}
          <Link href="/leagues/create?entry=player" className="block">
            <Button variant="primary" className={TILE_BUTTON_CLASS}>
              <TileLabel icon="diamond">Create Player League</TileLabel>
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
              <Button variant="primary" className={TILE_BUTTON_CLASS}>
                <TileLabel icon="trophy">Create Sports Sim League</TileLabel>
              </Button>
            </Link>
          </div>

          <div data-league-theme="day-trader">
            <Link href="/day-trader" className="block">
              <Button variant="primary" className={TILE_BUTTON_CLASS}>
                <TileLabel icon="bolt">StockDraft Day Trader</TileLabel>
              </Button>
            </Link>
          </div>
          <div data-league-theme="sddfs">
            <Link href="/stockdraft-dfs" className="block">
              <Button variant="primary" className={TILE_BUTTON_CLASS}>
                <TileLabel icon="calendarDay">StockDraft Daily Fantasy Sport</TileLabel>
              </Button>
            </Link>
          </div>
          <div data-league-theme="sdwfs">
            <Link href="/stockdraft-wfs" className="block">
              <Button variant="primary" className={TILE_BUTTON_CLASS}>
                <TileLabel icon="calendarWeek">StockDraft Weekly Fantasy Sport</TileLabel>
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

      <section className="crest-card p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold mb-1 text-gold">Join Public League</h2>
          <p className="text-muted text-sm">
            Browse open leagues that are still waiting for players and jump
            straight into the roster.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div
            style={
              {
                "--color-league-primary": "#dc2626",
                "--color-league-on-primary": "#ffffff",
              } as React.CSSProperties
            }
          >
            <Link href="/leagues/join-public/sports-sim" className="block">
              <Button variant="primary" className={TILE_BUTTON_CLASS}>
                <TileLabel icon="trophy">Join Sports Sim Leagues</TileLabel>
              </Button>
            </Link>
          </div>
          <Link href="/leagues/join-public/player" className="block">
            <Button variant="primary" className={TILE_BUTTON_CLASS}>
              <TileLabel icon="diamond">Join Player League</TileLabel>
            </Button>
          </Link>
        </div>
      </section>

      <section className="crest-card p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gold">My Leagues</h2>

        <div className="grid grid-cols-2 gap-3">
          <div data-league-theme="sdai">
            <Link href="/dashboard/sim-leagues" className="block">
              <Button variant="primary" className={TILE_BUTTON_CLASS}>
                <TileLabel icon="chart">Sim Leagues</TileLabel>
              </Button>
            </Link>
            <p className="text-muted text-xs text-center mt-1">
              {leagues.length > 0 ? `${leagues.length} active` : "None yet"}
            </p>
          </div>

          <div data-league-theme="sdpl">
            <Link href="/dashboard/player-leagues" className="block">
              <Button variant="primary" className={TILE_BUTTON_CLASS}>
                <TileLabel icon="diamond">Player Leagues</TileLabel>
              </Button>
            </Link>
            <p className="text-muted text-xs text-center mt-1">
              {squadLeagues.length > 0 ? `${squadLeagues.length} active` : "None yet"}
            </p>
          </div>

          <div
            style={
              {
                "--color-league-primary": "#dc2626",
                "--color-league-on-primary": "#ffffff",
              } as React.CSSProperties
            }
          >
            <Link href="/dashboard/sports-sim" className="block">
              <Button variant="primary" className={TILE_BUTTON_CLASS}>
                <TileLabel icon="trophy">Sports Sim</TileLabel>
              </Button>
            </Link>
            <p className="text-muted text-xs text-center mt-1">
              {sportsSimLeagues.length > 0
                ? `${sportsSimLeagues.length} active`
                : "None yet"}
            </p>
          </div>

          <div data-league-theme="day-trader">
            <Link href="/day-trader" className="block">
              <Button variant="primary" className={TILE_BUTTON_CLASS}>
                <TileLabel icon="bolt">Day Trader</TileLabel>
              </Button>
            </Link>
            <p className="text-muted text-xs text-center mt-1">
              {dayTrader ? "1 active" : "View"}
            </p>
          </div>

          <div data-league-theme="sddfs">
            <Link href="/stockdraft-dfs" className="block">
              <Button variant="primary" className={TILE_BUTTON_CLASS}>
                <TileLabel icon="calendarDay">Daily Fantasy Sport</TileLabel>
              </Button>
            </Link>
            <p className="text-muted text-xs text-center mt-1">View</p>
          </div>

          <div data-league-theme="sdwfs">
            <Link href="/stockdraft-wfs" className="block">
              <Button variant="primary" className={TILE_BUTTON_CLASS}>
                <TileLabel icon="calendarWeek">Weekly Fantasy Sport</TileLabel>
              </Button>
            </Link>
            <p className="text-muted text-xs text-center mt-1">View</p>
          </div>
        </div>
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
