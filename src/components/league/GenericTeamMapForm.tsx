"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { GenericFranchiseMap } from "@/components/league/GenericFranchiseMap";
import type { GenericMapPayload, GenericMapSport } from "@/lib/league/generic-team-map";

const MAP_IMAGE_BY_SPORT: Record<GenericMapSport, string> = {
  nba: "/images/league/sdba-map.png",
  nhl: "/images/league/sdhl-map.png",
  mlb: "/images/league/sdlb-map.png",
};

const SPORT_LABEL: Record<GenericMapSport, string> = {
  nba: "NBA",
  nhl: "NHL",
  mlb: "MLB",
};

const inputClass =
  "w-full rounded-xl border border-dark-border bg-dark px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-sm";

const COLOR_PRESETS = [
  { primary: "#0a3d8f", secondary: "#d0ab48", label: "Blue / Gold" },
  { primary: "#ef4444", secondary: "#f8fafc", label: "Red / White" },
  { primary: "#10b981", secondary: "#0f172a", label: "Green / Black" },
  { primary: "#8b5cf6", secondary: "#f97316", label: "Purple / Orange" },
  { primary: "#0369a1", secondary: "#94a3b8", label: "Navy / Silver" },
  { primary: "#be123c", secondary: "#e2e8f0", label: "Crimson / Ice" },
];

export function GenericTeamMapForm({ leagueId }: { leagueId: string }) {
  const router = useRouter();
  const [payload, setPayload] = useState<GenericMapPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claimingKey, setClaimingKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [franchiseCity, setFranchiseCity] = useState("");
  const [teamName, setTeamName] = useState("");
  const [primaryColor, setPrimaryColor] = useState(COLOR_PRESETS[0].primary);
  const [secondaryColor, setSecondaryColor] = useState(COLOR_PRESETS[0].secondary);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/leagues/${leagueId}/team-map`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not load the team map.");
        setPayload(null);
        return;
      }
      setPayload(data as GenericMapPayload);
      if (data.myIdentity?.franchiseCity) {
        setFranchiseCity(data.myIdentity.franchiseCity);
      }
      if (data.myIdentity?.teamName) {
        setTeamName(data.myIdentity.teamName);
      }
      if (data.myIdentity?.franchiseColors) {
        setPrimaryColor(data.myIdentity.franchiseColors.primary);
        setSecondaryColor(data.myIdentity.franchiseColors.secondary);
      }
    } catch {
      setError("Network error — try again.");
    } finally {
      setLoading(false);
    }
  }, [leagueId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleClaimSlot(slotKey: string) {
    setError(null);
    setClaimingKey(slotKey);
    try {
      const res = await fetch(`/api/leagues/${leagueId}/team-map`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotKey }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not claim that team.");
        await refresh();
        return;
      }
      setPayload(data as GenericMapPayload);
    } catch {
      setError("Network error — try again.");
    } finally {
      setClaimingKey(null);
    }
  }

  async function handleSubmitIdentity(e: React.FormEvent) {
    e.preventDefault();
    if (!payload?.mySlotKey) return;

    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/leagues/${leagueId}/team-map`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          franchiseCity,
          teamName,
          franchiseColors: { primary: primaryColor, secondary: secondaryColor },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not save franchise identity.");
        return;
      }
      setPayload(data as GenericMapPayload);
    } catch {
      setError("Network error — try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading && !payload) {
    return (
      <div className="rounded-2xl border border-dark-border bg-dark-card p-5 text-sm text-muted">
        Loading team setup…
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="rounded-2xl border border-dark-border bg-dark-card p-5 space-y-3">
        <p className="text-sm text-red-400">{error ?? "Team setup unavailable."}</p>
        <Button variant="secondary" onClick={() => router.push("/dashboard")}>
          Back to dashboard
        </Button>
      </div>
    );
  }

  const sportLabel = SPORT_LABEL[payload.sport];
  const identityComplete = payload.myIdentity?.complete ?? false;
  const hasClaimedSlot = Boolean(payload.mySlotKey);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-dark-border bg-dark-card p-5 space-y-2">
        <p className="text-xs uppercase tracking-wider text-gold font-semibold">
          {sportLabel} franchise setup
        </p>
        <h1 className="text-xl font-bold">{payload.leagueName}</h1>
        <p className="text-sm text-muted">
          Pick an open city on the map, then name your franchise. Real{" "}
          {sportLabel} team nicknames are blocked. The draft starts once
          every franchise is assigned.
        </p>
      </div>

      {identityComplete && payload.myIdentity ? (
        <div className="rounded-2xl border border-gold/30 bg-gold/5 p-5 space-y-3">
          <h2 className="text-lg font-semibold text-white">Your franchise</h2>
          <p className="text-sm text-muted">
            <span className="text-white font-medium">
              {payload.myIdentity.franchiseCity} {payload.myIdentity.teamName}
            </span>
            {" · "}
            {payload.myIdentity.city}
          </p>
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-6 w-6 rounded-full border border-white/20"
              style={{ backgroundColor: payload.myIdentity.franchiseColors?.primary }}
            />
            <span
              className="inline-block h-6 w-6 rounded-full border border-white/20"
              style={{ backgroundColor: payload.myIdentity.franchiseColors?.secondary }}
            />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="primary"
              className="flex-1"
              onClick={() => router.push(`/draft?league=${leagueId}`)}
            >
              {payload.status === "waiting" ? "Draft waiting room" : "Enter draft"}
            </Button>
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => router.push("/dashboard")}
            >
              Dashboard
            </Button>
          </div>
        </div>
      ) : (
        <>
          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-white">1. Claim a team</h2>
              <p className="text-sm text-muted mt-1">
                First come, first served — tap any open marker on the map.
              </p>
            </div>

            <GenericFranchiseMap
              imagePath={MAP_IMAGE_BY_SPORT[payload.sport]}
              markers={payload.markers}
              claims={payload.claims}
              mySlotKey={payload.mySlotKey}
              claimingKey={claimingKey}
              previewColor={hasClaimedSlot ? primaryColor : null}
              onClaimSlot={(slotKey) => void handleClaimSlot(slotKey)}
            />
          </section>

          {hasClaimedSlot && payload.myIdentity?.city ? (
            <section className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-white">
                  2. Build your franchise
                </h2>
                <p className="text-sm text-muted mt-1">
                  Claimed:{" "}
                  <span className="text-white font-medium">
                    {payload.myIdentity.city}
                  </span>
                </p>
              </div>

              <form onSubmit={handleSubmitIdentity} className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold mb-1.5" htmlFor="city">
                    City / town
                  </label>
                  <input
                    id="city"
                    className={inputClass}
                    value={franchiseCity}
                    onChange={(e) => setFranchiseCity(e.target.value)}
                    maxLength={60}
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold mb-1.5" htmlFor="teamName">
                    Team name
                  </label>
                  <input
                    id="teamName"
                    className={inputClass}
                    value={teamName}
                    onChange={(e) => setTeamName(e.target.value)}
                    maxLength={40}
                    required
                  />
                  <p className="text-xs text-muted mt-1">
                    Cannot include real {sportLabel} nicknames (e.g. real team names).
                  </p>
                </div>

                <div>
                  <p className="block text-sm font-semibold mb-2">Color scheme</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {COLOR_PRESETS.map((preset) => {
                      const selected =
                        primaryColor === preset.primary &&
                        secondaryColor === preset.secondary;
                      return (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => {
                            setPrimaryColor(preset.primary);
                            setSecondaryColor(preset.secondary);
                          }}
                          className={[
                            "flex items-center gap-3 rounded-xl border px-3 py-2 text-left text-sm transition-colors",
                            selected
                              ? "border-gold bg-gold/10"
                              : "border-dark-border bg-dark hover:border-primary/40",
                          ].join(" ")}
                        >
                          <span
                            className="h-5 w-5 rounded-full border border-white/20"
                            style={{ backgroundColor: preset.primary }}
                          />
                          <span
                            className="h-5 w-5 rounded-full border border-white/20"
                            style={{ backgroundColor: preset.secondary }}
                          />
                          <span className="text-white">{preset.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {error && <p className="text-sm text-red-400">{error}</p>}

                <Button
                  type="submit"
                  variant="primary"
                  className="w-full"
                  disabled={submitting}
                >
                  {submitting ? "Saving…" : "Save franchise identity"}
                </Button>
              </form>
            </section>
          ) : (
            <div className="rounded-xl border border-dark-border bg-dark/40 p-4 text-sm text-muted">
              Claim a team above to continue with your city, team name, and
              colors.
            </div>
          )}
        </>
      )}

      {error && !identityComplete && hasClaimedSlot ? null : error ? (
        <p className="text-sm text-red-400">{error}</p>
      ) : null}
    </div>
  );
}
