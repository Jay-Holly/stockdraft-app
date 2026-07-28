"use client";

import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";
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

type TileArt =
  | "create-free-sim"
  | "create-player-league"
  | "create-sports-sim"
  | "create-day-trader"
  | "create-daily-fantasy"
  | "create-weekly-fantasy"
  | "join-sports-sim"
  | "join-player-league"
  | "my-sim-leagues"
  | "my-player-leagues"
  | "my-sports-sim"
  | "my-day-trader"
  | "my-daily-fantasy"
  | "my-weekly-fantasy";

function DashboardTile({
  art,
  label,
  href,
  onClick,
}: {
  art: TileArt;
  label: string;
  href?: string;
  onClick?: () => void;
}) {
  const className =
    "group relative block w-full overflow-hidden rounded-xl transition-transform duration-300 hover:-translate-y-0.5 active:scale-[0.98]";
  const content = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/images/dashboard-cards/${art}.png`}
      alt={label}
      className="h-auto w-full"
      draggable={false}
    />
  );

  if (href) {
    return (
      <Link href={href} className={className} aria-label={label}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={className} aria-label={label}>
      {content}
    </button>
  );
}

type SheetHotspot = {
  label: string;
  href?: string;
  onClick?: () => void;
  top: string;
  left: string;
  width: string;
  height: string;
  badge?: string;
};

function DashboardSheet({
  src,
  alt,
  hotspots,
}: {
  src: string;
  alt: string;
  hotspots: SheetHotspot[];
}) {
  return (
    <div className="relative w-full">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="h-auto w-full select-none" draggable={false} />
      {hotspots.map((h) => {
        const style = { top: h.top, left: h.left, width: h.width, height: h.height };
        const inner = h.badge ? (
          <span className="absolute bottom-1 right-2 text-[11px] font-semibold text-white/80 drop-shadow">
            {h.badge}
          </span>
        ) : null;
        if (h.href) {
          return (
            <Link key={h.label} href={h.href} aria-label={h.label} className="absolute" style={style}>
              {inner}
            </Link>
          );
        }
        return (
          <button
            key={h.label}
            type="button"
            onClick={h.onClick}
            aria-label={h.label}
            className="absolute"
            style={style}
          >
            {inner}
          </button>
        );
      })}
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
  dfsEntryCount = 0,
  wfsEntryCount = 0,
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
  dfsEntryCount?: number;
  wfsEntryCount?: number;
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
            src={showBotSelection ? "/images/leagues/sdai.png" : "/images/brand/sdlogo.png"}
            alt="StockDraft"
            width={140}
            height={210}
            className="h-44 w-auto shrink-0 -my-12 drop-shadow-[0_0_28px_rgba(208,171,72,0.5)]"
            priority
          />
        </div>
      </section>

      <LiveTickerTape />

      <section className="crest-card p-0.5 space-y-4">
        {!showBotSelection && (
          <DashboardSheet
            src="/images/dashboard-cards/create-league-sheet.png"
            alt="Create New League"
            hotspots={[
              {
                label: "Create Free Sim League",
                onClick: () => {
                  setLeagueError(null);
                  setShowBotSelection(true);
                },
                top: "43.2%",
                left: "4.8%",
                width: "43.9%",
                height: "13.8%",
              },
              {
                label: "Create Player League",
                href: "/leagues/create?entry=player",
                top: "43.2%",
                left: "50.9%",
                width: "44%",
                height: "13.8%",
              },
              {
                label: "Create Sports Sim League",
                href: "/leagues/create?entry=sports",
                top: "59.4%",
                left: "4.8%",
                width: "43.9%",
                height: "14.8%",
              },
              {
                label: "StockDraft Day Trader",
                href: "/day-trader",
                top: "59.4%",
                left: "50.9%",
                width: "44%",
                height: "14.8%",
              },
              {
                label: "StockDraft Daily Fantasy Sport",
                href: "/stockdraft-dfs",
                top: "76.5%",
                left: "4.8%",
                width: "43.9%",
                height: "14.6%",
              },
              {
                label: "StockDraft Weekly Fantasy Sport",
                href: "/stockdraft-wfs",
                top: "76.5%",
                left: "50.9%",
                width: "44%",
                height: "14.6%",
              },
            ]}
          />
        )}

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

      <section className="crest-card p-0.5 space-y-4">
        <DashboardSheet
          src="/images/dashboard-cards/join-league-sheet.png"
          alt="Join Public League"
          hotspots={[
            {
              label: "Join Sports Sim Leagues",
              href: "/leagues/join-public/sports-sim",
              top: "53.3%",
              left: "5%",
              width: "43.6%",
              height: "29.3%",
            },
            {
              label: "Join Player League",
              href: "/leagues/join-public/player",
              top: "53.3%",
              left: "50.9%",
              width: "44%",
              height: "29.3%",
            },
          ]}
        />
      </section>

      <section className="crest-card p-0.5 space-y-4">
        <DashboardSheet
          src="/images/dashboard-cards/my-league-sheet.png"
          alt="My Leagues"
          hotspots={[
            {
              label: "Sim Leagues",
              href: "/dashboard/sim-leagues",
              top: "21.2%",
              left: "4.7%",
              width: "44.1%",
              height: "15.3%",
              badge: leagues.length > 0 ? `${leagues.length} active` : "None yet",
            },
            {
              label: "Player Leagues",
              href: "/dashboard/player-leagues",
              top: "21.2%",
              left: "50.9%",
              width: "43.8%",
              height: "15.3%",
              badge: squadLeagues.length > 0 ? `${squadLeagues.length} active` : "None yet",
            },
            {
              label: "Sports Sim",
              href: "/dashboard/sports-sim-selector",
              top: "45%",
              left: "4.7%",
              width: "44.1%",
              height: "15%",
              badge:
                sportsSimLeagues.length > 0 ? `${sportsSimLeagues.length} active` : "None yet",
            },
            {
              label: "Day Trader",
              href: "/day-trader",
              top: "45%",
              left: "50.9%",
              width: "43.8%",
              height: "15%",
              badge: dayTrader ? "1 active" : "View",
            },
            {
              label: "Daily Fantasy Sport",
              href: "/stockdraft-dfs",
              top: "68.4%",
              left: "4.7%",
              width: "44.1%",
              height: "16.5%",
              badge: dfsEntryCount > 0 ? `${dfsEntryCount} active` : "None yet",
            },
            {
              label: "Weekly Fantasy Sport",
              href: "/stockdraft-wfs",
              top: "68.4%",
              left: "50.9%",
              width: "43.8%",
              height: "16.5%",
              badge: wfsEntryCount > 0 ? `${wfsEntryCount} active` : "None yet",
            },
          ]}
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
