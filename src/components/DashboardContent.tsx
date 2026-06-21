"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  AVATAR_COLORS,
  getAvatarHex,
  type AvatarColorId,
  type Profile,
} from "@/lib/types";
import type {
  AiLeagueListItem,
  AiLeagueSummary,
} from "@/lib/league/ai-league";
import { BotSelectionPanel } from "@/components/league/BotSelectionPanel";
import type { BotPersonality } from "@/lib/league/bots";
import { Button } from "@/components/Button";
import { LiveTickerTape } from "@/components/LiveTickerTape";
import { DraftRoster } from "@/components/draft/DraftRoster";
import type { DraftPick } from "@/lib/draft/types";

function formatPct(value: number | null | undefined): string {
  if (value == null) return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function leagueStatusLabel(status: string): string {
  if (status === "drafting") return "Draft in progress";
  if (status === "active") return "Season active";
  return "Season complete";
}

function MatchupResultCard({
  weekNumber,
  opponentName,
  humanScorePct,
  opponentScorePct,
  winner,
  upcoming = false,
}: {
  weekNumber: number;
  opponentName: string;
  humanScorePct: number | null;
  opponentScorePct: number | null;
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
          Scores on your next dashboard visit using live prices for active roster
          picks (10 stocks + crypto, bench excluded).
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
                {formatPct(humanScorePct)}
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
                {formatPct(opponentScorePct)}
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
  email,
  draftComplete = false,
  draftPicks = [],
  leagues = [],
  activeLeagueId = null,
  activeSummary = null,
}: {
  profile: Profile;
  email: string;
  draftComplete?: boolean;
  draftPicks?: DraftPick[];
  leagues?: AiLeagueListItem[];
  activeLeagueId?: string | null;
  activeSummary?: AiLeagueSummary | null;
}) {
  const router = useRouter();
  const [username, setUsername] = useState(profile.username);
  const [teamName, setTeamName] = useState(profile.team_name);
  const [avatarColor, setAvatarColor] = useState<AvatarColorId>(
    profile.avatar_color as AvatarColorId
  );
  const [saving, setSaving] = useState(false);
  const [startingLeague, setStartingLeague] = useState(false);
  const [switchingLeagueId, setSwitchingLeagueId] = useState<string | null>(
    null
  );
  const [showBotSelection, setShowBotSelection] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [leagueError, setLeagueError] = useState<string | null>(null);

  const supabase = createClient();
  const avatarHex = getAvatarHex(avatarColor);
  const initials = username.slice(0, 2).toUpperCase();

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    const { error } = await supabase
      .from("profiles")
      .update({
        username,
        team_name: teamName,
        avatar_color: avatarColor,
      })
      .eq("id", profile.id);

    setSaving(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage("Profile saved!");
  }

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

  async function handleCreateLeague(botPersonalities: BotPersonality[]) {
    setStartingLeague(true);
    setLeagueError(null);

    try {
      const response = await fetch("/api/leagues/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botPersonalities }),
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

  return (
    <div className="space-y-6">
      <section className="bg-dark-card border border-dark-border rounded-2xl p-6">
        <div className="flex items-center gap-4">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center text-xl font-black text-white shrink-0"
            style={{ backgroundColor: avatarHex }}
          >
            {initials}
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold truncate">{teamName}</h1>
            <p className="text-muted text-sm truncate">@{username}</p>
            <p className="text-muted text-xs mt-1">Member since {createdDate}</p>
          </div>
        </div>
      </section>

      <LiveTickerTape />

      <section className="bg-dark-card border border-gold/30 rounded-2xl p-6">
        <h2 className="text-lg font-semibold mb-1">Create New League</h2>
        <p className="text-muted text-sm mb-4">
          Start a fresh Free AI League anytime — pick three new bot opponents and
          enter a live draft. Each league is fully independent (own draft pool,
          off-board, standings, and season).
        </p>
        {leagueError && !showBotSelection && (
          <p className="text-sm text-red-400 mb-3">{leagueError}</p>
        )}
        {showBotSelection ? (
          <BotSelectionPanel
            teamName={teamName}
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
            variant="primary"
            className="w-full"
            onClick={() => {
              setLeagueError(null);
              setShowBotSelection(true);
            }}
          >
            Create New League
          </Button>
        )}
      </section>

      {leagues.length > 0 && (
        <section className="bg-dark-card border border-dark-border rounded-2xl p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold">My Leagues</h2>
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
                    <p className="font-semibold truncate">{item.league.name}</p>
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
                  {item.league.status === "active" && item.humanDraftComplete && (
                    <>
                      <Button
                        variant="secondary"
                        className="text-xs px-3"
                        disabled={busy}
                        onClick={() =>
                          void setActiveLeague(item.league.id, "/league")
                        }
                      >
                        League
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
                </div>
              </div>
            );
          })}
        </section>
      )}

      {activeSummary && activeSummary.league.id === activeLeagueId && (
        <section className="bg-dark-card border border-dark-border rounded-2xl p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Selected league</h2>
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

          {activeSummary.lastCompletedMatchup &&
            activeSummary.league.status !== "drafting" && (
              <MatchupResultCard
                weekNumber={activeSummary.lastCompletedMatchup.weekNumber}
                opponentName={activeSummary.lastCompletedMatchup.opponentName}
                humanScorePct={activeSummary.lastCompletedMatchup.humanScorePct}
                opponentScorePct={
                  activeSummary.lastCompletedMatchup.opponentScorePct
                }
                winner={activeSummary.lastCompletedMatchup.winner}
              />
            )}

          {activeSummary.currentMatchup &&
            activeSummary.league.status !== "drafting" &&
            activeSummary.currentMatchup.status === "scheduled" && (
              <MatchupResultCard
                weekNumber={activeSummary.currentMatchup.weekNumber}
                opponentName={activeSummary.currentMatchup.opponentName}
                humanScorePct={null}
                opponentScorePct={null}
                winner={null}
                upcoming
              />
            )}
        </section>
      )}

      <section className="bg-dark-card border border-dark-border rounded-2xl p-6">
        <h2 className="text-lg font-semibold mb-1">Your profile</h2>
        <p className="text-muted text-sm mb-6">{email}</p>

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Username
            </label>
            <input
              type="text"
              required
              minLength={3}
              maxLength={24}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Team name
            </label>
            <input
              type="text"
              required
              maxLength={40}
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Avatar color
            </label>
            <div className="flex gap-2 flex-wrap">
              {AVATAR_COLORS.map((color) => (
                <button
                  key={color.id}
                  type="button"
                  title={color.label}
                  onClick={() => setAvatarColor(color.id)}
                  className={`w-9 h-9 rounded-full transition-transform ${
                    avatarColor === color.id
                      ? "ring-2 ring-gold ring-offset-2 ring-offset-dark-card scale-110"
                      : "hover:scale-105"
                  }`}
                  style={{ backgroundColor: color.hex }}
                />
              ))}
            </div>
          </div>

          {message && <p className="text-sm text-green-400">{message}</p>}

          <Button type="submit" variant="primary" disabled={saving} className="w-full">
            {saving ? "Saving…" : "Save profile"}
          </Button>
        </form>
      </section>

      {draftComplete && draftPicks.length > 0 && activeSummary?.league.status !== "drafting" && (
        <DraftRoster picks={draftPicks} />
      )}

      <Button variant="ghost" onClick={handleSignOut} className="w-full">
        Sign out
      </Button>
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-dark-border bg-dark px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-sm";
