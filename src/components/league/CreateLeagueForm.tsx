"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import {
  isHumanLeaguePoCSupported,
  SPORTS_LEAGUE_FORMATS,
  STANDARD_PLAYER_COUNTS,
  unsupportedLeagueConfigMessage,
  type CreateLeagueConfig,
  type LeagueFormatType,
  type LeagueOpponentType,
  type LeaguePlayerCount,
  type LeagueVisibility,
} from "@/lib/league/league-config";

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
  const [playerCount, setPlayerCount] = useState<LeaguePlayerCount>(2);
  const [visibility, setVisibility] = useState<LeagueVisibility>("private");
  const [opponentType, setOpponentType] = useState<LeagueOpponentType>("all_human");
  const [leagueName, setLeagueName] = useState("");
  const [teamName, setTeamName] = useState(defaultTeamName);
  const [inviteEmail, setInviteEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [createdLeagueName, setCreatedLeagueName] = useState<string | null>(null);

  const config = useMemo<CreateLeagueConfig>(
    () => ({
      formatType,
      sportsLeagueId,
      playerCount,
      visibility,
      opponentType,
      leagueName,
      teamName,
      inviteEmail,
    }),
    [
      formatType,
      sportsLeagueId,
      playerCount,
      visibility,
      opponentType,
      leagueName,
      teamName,
      inviteEmail,
    ]
  );

  const supported = isHumanLeaguePoCSupported(config);
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

      setInviteLink(data.inviteLink ?? null);
      setCreatedLeagueName(leagueName.trim());
    } catch {
      setError("Network error — try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function copyInviteLink() {
    if (!inviteLink) return;
    void navigator.clipboard.writeText(inviteLink);
  }

  if (inviteLink) {
    return (
      <div className="space-y-5">
        <div className="rounded-2xl border border-gold/40 bg-gold/5 p-5 space-y-3">
          <h2 className="text-lg font-semibold text-white">
            {createdLeagueName} is ready
          </h2>
          <p className="text-sm text-muted">
            Share this invite link with{" "}
            <span className="text-white font-medium">{inviteEmail}</span>. Once
            they join, the live draft starts automatically.
          </p>
          <div className="rounded-xl border border-dark-border bg-dark p-3 break-all text-xs text-gold font-mono">
            {inviteLink}
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
        onChange={setFormatType}
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
          onChange={setSportsLeagueId}
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
          options={STANDARD_PLAYER_COUNTS.map((count) => ({
            value: count,
            label: String(count),
            hint: count === 2 ? "Available now" : "Coming soon",
          }))}
        />
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
          <input
            id="teamName"
            className={inputClass}
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder={defaultTeamName}
            maxLength={40}
            required
          />
        </div>

        {supported && (
          <div>
            <label className="block text-sm font-semibold mb-1.5" htmlFor="inviteEmail">
              Invite player 2 (email)
            </label>
            <input
              id="inviteEmail"
              type="email"
              className={inputClass}
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="friend@example.com"
              required
            />
            <p className="text-xs text-muted mt-1.5">
              We&apos;ll show you a link to send manually — no email is sent automatically yet.
            </p>
          </div>
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
          {submitting ? "Creating…" : supported ? "Create & get invite link" : "Coming soon"}
        </Button>
      </div>
    </form>
  );
}
