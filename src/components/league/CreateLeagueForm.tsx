"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { buildInviteLinkPath } from "@/lib/app-url";
import {
  FAST_TIMER_PRESETS,
  isHumanLeagueSupported,
  playerCountsForFormat,
  playerCountForSportsLeague,
  requiresScheduledDraft,
  SPORTS_LEAGUE_FORMATS,
  unsupportedLeagueConfigMessage,
  type CreateLeagueConfig,
  type LeagueFormatType,
  type LeagueOpponentType,
  type LeaguePlayerCount,
  type LeagueScoringMode,
  type LeagueVisibility,
} from "@/lib/league/league-config";
import {
  DRAFT_ORDER_METHOD_LABELS,
  type DraftOrderMethodSetting,
} from "@/lib/league/draft-order";
import { isSdflLeague, sdflIdentityPath } from "@/lib/league/sdfl-divisions";

const inputClass =
  "w-full rounded-xl border border-dark-border bg-dark px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-sm";

type SelectorOption<T extends string | number> = {
  value: T;
  label: string;
  hint?: string;
};

function OptionGroup<T extends string | number>({
  label,
  description,
  value,
  options,
  onChange,
}: {
  label: string;
  description?: string;
  value: T;
  options: SelectorOption<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold text-white">{label}</legend>
      {description && <p className="text-xs text-muted -mt-1">{description}</p>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <button
              key={String(option.value)}
              type="button"
              onClick={() => onChange(option.value)}
              className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                selected
                  ? "border-gold/60 bg-gold/10 text-white"
                  : "border-dark-border bg-dark/40 text-muted hover:border-dark-border hover:text-white"
              }`}
            >
              <span className="block text-sm font-semibold">{option.label}</span>
              {option.hint && (
                <span className="block text-[0.6875rem] mt-0.5 opacity-80">
                  {option.hint}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function CreateLeagueForm({
  defaultTeamName,
}: {
  defaultTeamName: string;
}) {
  const router = useRouter();
  const [formatType, setFormatType] = useState<LeagueFormatType>("standard");
  const [sportsLeagueId, setSportsLeagueId] = useState("sdfl");
  const [playerCount, setPlayerCount] = useState<LeaguePlayerCount>(4);
  const [visibility, setVisibility] = useState<LeagueVisibility>("private");
  const [opponentType, setOpponentType] = useState<LeagueOpponentType>("all_human");
  const [pickTimeSeconds, setPickTimeSeconds] = useState<number>(120);
  const [scoringMode, setScoringMode] =
    useState<LeagueScoringMode>("percent_gain");
  const [leagueName, setLeagueName] = useState("");
  const [teamName, setTeamName] = useState(defaultTeamName);
  const [scheduledDraftAt, setScheduledDraftAt] = useState("");
  const [draftOrderMethod, setDraftOrderMethod] =
    useState<DraftOrderMethodSetting>("random_shuffle");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [createdLeagueName, setCreatedLeagueName] = useState<string | null>(null);
  const [createdLeagueId, setCreatedLeagueId] = useState<string | null>(null);

  useEffect(() => {
    if (inviteToken && typeof window !== "undefined") {
      setShareLink(`${window.location.origin}${buildInviteLinkPath(inviteToken)}`);
      return;
    }
    setShareLink(inviteLink);
  }, [inviteToken, inviteLink]);

  const config = useMemo<CreateLeagueConfig>(
    () => ({
      formatType,
      sportsLeagueId,
      playerCount,
      visibility,
      opponentType,
      scoringMode,
      leagueName,
      teamName,
      scheduledDraftAt: scheduledDraftAt
        ? new Date(scheduledDraftAt).toISOString()
        : null,
      draftOrderMethod:
        formatType === "standard" ? draftOrderMethod : undefined,
      pickTimeSeconds: opponentType === "all_ai" ? pickTimeSeconds : undefined,
    }),
    [
      formatType,
      sportsLeagueId,
      playerCount,
      visibility,
      opponentType,
      scoringMode,
      leagueName,
      teamName,
      scheduledDraftAt,
      draftOrderMethod,
      pickTimeSeconds,
    ]
  );

  const supported = isHumanLeagueSupported(config);
  const needsSchedule = requiresScheduledDraft(config);
  const usesShareableInvite =
    config.visibility === "private" && config.opponentType === "all_human";
  const inviteSlotsRemaining = Math.max(playerCount - 1, 0);
  const allHumanLeague = config.opponentType === "all_human";
  const isSdfl =
    formatType === "sports_league" && isSdflLeague(sportsLeagueId);
  const playerCountOptions = playerCountsForFormat(formatType, sportsLeagueId);
  const requiredSportsPlayerCount = playerCountForSportsLeague(sportsLeagueId);

  useEffect(() => {
    if (formatType !== "sports_league") return;
    const required = playerCountForSportsLeague(sportsLeagueId);
    if (required != null) {
      setPlayerCount(required);
    }
  }, [formatType, sportsLeagueId]);
  const draftOrderOptions = (
    Object.keys(DRAFT_ORDER_METHOD_LABELS) as DraftOrderMethodSetting[]
  ).map((method) => ({
    value: method,
    label: DRAFT_ORDER_METHOD_LABELS[method].label,
    hint: DRAFT_ORDER_METHOD_LABELS[method].description,
  }));
  const comingSoonMessage = supported ? null : unsupportedLeagueConfigMessage(config);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!supported) {
      setError(comingSoonMessage ?? "This configuration is not available yet.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/leagues/human", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not create league.");
        return;
      }

      const leagueId =
        typeof data.activeLeagueId === "string"
          ? data.activeLeagueId
          : typeof data.league?.id === "string"
            ? data.league.id
            : null;

      const identityPath =
        typeof data.redirectTo === "string"
          ? data.redirectTo
          : isSdfl && leagueId
            ? sdflIdentityPath(leagueId)
            : null;

      if (identityPath) {
        router.push(identityPath);
        return;
      }

      setCreatedLeagueId(leagueId);
      setInviteToken(
        typeof data.inviteToken === "string" ? data.inviteToken : null
      );
      setInviteLink(data.inviteLink ?? null);
      setCreatedLeagueName(leagueName.trim());
    } catch {
      setError("Network error — try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function copyInviteLink() {
    if (!shareLink) return;
    void navigator.clipboard.writeText(shareLink);
  }

  if (shareLink || createdLeagueName) {
    return (
      <div className="space-y-5">
        <div className="rounded-2xl border border-gold/40 bg-gold/5 p-5 space-y-3">
          <h2 className="text-lg font-semibold text-white">
            {createdLeagueName} is ready
          </h2>
          <p className="text-sm text-muted">
            {shareLink ? (
              <>
                Share this invite link with up to {inviteSlotsRemaining} friend
                {inviteSlotsRemaining === 1 ? "" : "s"}. Anyone with the link can
                join until all {playerCount} roster spots are filled.
                {isSdfl
                  ? " Claim your franchise identity before sharing invites."
                  : needsSchedule && allHumanLeague
                    ? " The live draft begins at your scheduled time once the roster is full."
                    : needsSchedule
                      ? " The draft starts at your scheduled time — open slots fill with managers automatically."
                      : " The live draft starts automatically once the league is full."}
              </>
            ) : (
              <>
                Your league is created.
                {isSdfl
                  ? " Set up your SDFL franchise identity next."
                  : needsSchedule
                    ? " Open slots will fill with managers at your scheduled draft time."
                    : " Waiting for players to join."}
              </>
            )}
          </p>
          {isSdfl && createdLeagueId ? (
            <Button
              variant="primary"
              className="w-full"
              onClick={() => router.push(sdflIdentityPath(createdLeagueId))}
            >
              Set up your franchise
            </Button>
          ) : null}
          {shareLink && (
            <>
              <div className="rounded-xl border border-dark-border bg-dark p-3 break-all text-xs text-gold font-mono">
                {shareLink}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button variant="secondary" className="flex-1" onClick={copyInviteLink}>
                  Copy link
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  onClick={() => router.push("/dashboard")}
                >
                  Back to dashboard
                </Button>
              </div>
            </>
          )}
          {!shareLink && (
            <Button variant="primary" onClick={() => router.push("/dashboard")}>
              Back to dashboard
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <OptionGroup<LeagueFormatType>
        label="Format type"
        description="Standard is the 13-week NFL Package style season."
        value={formatType}
        onChange={(value) => {
          setFormatType(value);
          if (value === "sports_league") {
            const required = playerCountForSportsLeague(sportsLeagueId);
            if (required != null) setPlayerCount(required);
          } else if (playerCount > 12) {
            setPlayerCount(4);
          }
        }}
        options={[
          { value: "standard", label: "Standard", hint: "13-week season" },
          {
            value: "sports_league",
            label: "Sports League",
            hint: "SDFL · SDHL · SDBA · SDLB",
          },
        ]}
      />

      {formatType === "sports_league" && (
        <OptionGroup<string>
          label="Sports league"
          value={sportsLeagueId}
          onChange={(value) => {
            setSportsLeagueId(value);
            const required = playerCountForSportsLeague(value);
            if (required != null) setPlayerCount(required);
          }}
          options={SPORTS_LEAGUE_FORMATS.map((f) => ({
            value: f.id,
            label: f.label,
            hint: f.description,
          }))}
        />
      )}

      {formatType === "standard" && (
        <OptionGroup<LeaguePlayerCount>
          label="Player count"
          value={playerCount}
          onChange={setPlayerCount}
          options={playerCountOptions.map((count) => ({
            value: count,
            label: String(count),
          }))}
        />
      )}

      {formatType === "sports_league" && requiredSportsPlayerCount != null && (
        <div className="rounded-xl border border-dark-border bg-dark/40 px-4 py-3">
          <p className="text-sm font-semibold">League size</p>
          <p className="text-sm text-muted mt-1">
            {requiredSportsPlayerCount} teams — fixed for this format. Open slots
            fill with managers or bots at draft time.
          </p>
        </div>
      )}

      {formatType === "standard" && (
        <OptionGroup<DraftOrderMethodSetting>
          label="Draft order method"
          description="Pick positions are assigned when the live draft starts. Random shuffle is the default baseline."
          value={draftOrderMethod}
          onChange={setDraftOrderMethod}
          options={draftOrderOptions}
        />
      )}

      {formatType === "sports_league" && (
        <p className="text-xs text-muted rounded-xl border border-dark-border bg-dark/40 px-4 py-3">
          Sports League draft order will eventually follow each format&apos;s prior-season
          standings (NFL, NHL, NBA, MLB) — refreshed automatically the day after each
          championship. Until then, pick order is assigned with a random shuffle at draft
          start. Only StockDraft franchise identities appear in the app.
        </p>
      )}

      <OptionGroup<LeagueVisibility>
        label="Public or private"
        value={visibility}
        onChange={setVisibility}
        options={[
          { value: "private", label: "Private", hint: "Invite only" },
          { value: "public", label: "Public", hint: "Open enrollment" },
        ]}
      />

      <OptionGroup<LeagueOpponentType>
        label="Opponent type"
        value={opponentType}
        onChange={setOpponentType}
        options={[
          { value: "all_human", label: "All Human", hint: "Friends only" },
          { value: "all_ai", label: "All AI", hint: "Bot managers" },
          { value: "mixed", label: "Mixed", hint: "Humans + bots" },
        ]}
      />

      {opponentType === "all_ai" && (
        <OptionGroup<number>
          label="Pick timer"
          description="All-bot leagues can run faster for quick test drafts."
          value={pickTimeSeconds}
          onChange={setPickTimeSeconds}
          options={FAST_TIMER_PRESETS.map((seconds) => ({
            value: seconds,
            label: `${seconds}s`,
            hint: seconds <= 15 ? "Fast test draft" : undefined,
          }))}
        />
      )}

      <OptionGroup<LeagueScoringMode>
        label="Weekly matchup scoring"
        description="Locked for the season. Winner of the Week always uses total dollar gain across your full roster."
        value={scoringMode}
        onChange={setScoringMode}
        options={[
          {
            value: "percent_gain",
            label: "% Gain Mode",
            hint: "Win by weekly % gain (starters + crypto)",
          },
          {
            value: "dollar_gain",
            label: "$ Gain Mode",
            hint: "Win by weekly $ gain (starters + crypto)",
          },
        ]}
      />

      <div className="space-y-4 pt-2 border-t border-dark-border">
        <div>
          <label className="block text-sm font-semibold mb-1.5" htmlFor="leagueName">
            League name
          </label>
          <input
            id="leagueName"
            className={inputClass}
            value={leagueName}
            onChange={(e) => setLeagueName(e.target.value)}
            placeholder="Sunday Stock Showdown"
            maxLength={60}
            required
          />
        </div>

        <div>
          <label className="block text-sm font-semibold mb-1.5" htmlFor="teamName">
            Your team name
          </label>
          {!isSdfl ? (
            <input
              id="teamName"
              className={inputClass}
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder={defaultTeamName}
              maxLength={40}
              required
            />
          ) : (
            <p className="text-sm text-muted rounded-xl border border-dark-border bg-dark/40 px-4 py-3">
              You&apos;ll set your franchise city, team name, and colors on the next
              screen after creating the league.
            </p>
          )}
        </div>

        {needsSchedule && (
          <div>
            <label
              className="block text-sm font-semibold mb-1.5"
              htmlFor="scheduledDraftAt"
            >
              Scheduled draft
            </label>
            <input
              id="scheduledDraftAt"
              type="datetime-local"
              className={inputClass}
              value={scheduledDraftAt}
              onChange={(e) => setScheduledDraftAt(e.target.value)}
              required={needsSchedule}
            />
            <p className="text-xs text-muted mt-1.5">
              {allHumanLeague
                ? "The live draft begins at this time once every roster spot is filled."
                : "At this time, any empty roster spot is filled automatically so the draft can start on schedule."}
            </p>
          </div>
        )}

        {usesShareableInvite && (
          <p className="text-xs text-muted rounded-xl border border-dark-border bg-dark/40 px-4 py-3">
            After you create the league, you&apos;ll get a shareable invite link
            for up to {inviteSlotsRemaining} friend
            {inviteSlotsRemaining === 1 ? "" : "s"}. Anyone with the link can
            join until all {playerCount} roster spots are filled.
            {needsSchedule
              ? " Set a draft time below — the live draft begins once the roster is full and that time is reached."
              : ""}
          </p>
        )}
      </div>

      {!supported && comingSoonMessage && (
        <p className="text-sm text-amber-300/90 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          {comingSoonMessage}
        </p>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          variant="secondary"
          className="flex-1"
          onClick={() => router.push("/dashboard")}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          className="flex-1"
          disabled={submitting || !supported}
        >
          {submitting ? "Creating…" : "Create league"}
        </Button>
      </div>
    </form>
  );
}
