"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import {
  slotKey,
  type SdflDivisionSlot,
} from "@/lib/league/sdfl-divisions";
import type { LeagueIdentityPayload } from "@/lib/league/team-identity";
import { SdflFranchiseMap } from "@/components/league/SdflFranchiseMap";

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

export function SdflIdentityForm({ leagueId }: { leagueId: string }) {
  const router = useRouter();
  const [payload, setPayload] = useState<LeagueIdentityPayload | null>(null);
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
      const res = await fetch(`/api/leagues/${leagueId}/identity`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not load franchise setup.");
        setPayload(null);
        return;
      }
      setPayload(data as LeagueIdentityPayload);
      if (data.myIdentity?.franchiseCity) {
        setFranchiseCity(data.myIdentity.franchiseCity);
      }
      if (data.myIdentity?.teamName && data.myIdentity.teamName !== "Pending") {
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

  const mySlotKey =
    payload?.myIdentity?.conference &&
    payload?.myIdentity?.division &&
    payload?.myIdentity?.divisionSlot
      ? slotKey({
          conference: payload.myIdentity.conference,
          division: payload.myIdentity.division,
          divisionSlot: payload.myIdentity.divisionSlot,
        })
      : null;

  async function handleClaimSlot(slot: SdflDivisionSlot) {
    setError(null);
    setClaimingKey(slotKey(slot));
    try {
      const res = await fetch(`/api/leagues/${leagueId}/identity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(slot),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not claim that slot.");
        await refresh();
        return;
      }
      await refresh();
    } catch {
      setError("Network error — try again.");
    } finally {
      setClaimingKey(null);
    }
  }

  async function handleSubmitIdentity(e: React.FormEvent) {
    e.preventDefault();
    if (!mySlotKey) return;

    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/leagues/${leagueId}/identity`, {
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
      await refresh();
    } catch {
      setError("Network error — try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-dark-border bg-dark-card p-5 text-sm text-muted">
        Loading franchise setup…
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="rounded-2xl border border-dark-border bg-dark-card p-5 space-y-3">
        <p className="text-sm text-red-400">{error ?? "Franchise setup unavailable."}</p>
        <Button variant="secondary" onClick={() => router.push("/dashboard")}>
          Back to dashboard
        </Button>
      </div>
    );
  }

  const identityComplete = payload.myIdentity?.complete ?? false;
  const hasClaimedSlot = Boolean(mySlotKey);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-dark-border bg-dark-card p-5 space-y-2">
        <p className="text-xs uppercase tracking-wider text-gold font-semibold">
          SDFL franchise setup
        </p>
        <h1 className="text-xl font-bold">{payload.leagueName}</h1>
        <p className="text-sm text-muted">
          Pick an open conference and division slot, then name your franchise.
          NFL team nicknames are blocked. The draft starts once all{" "}
          {payload.playerCount} franchises are assigned.
        </p>
        <p className="text-sm text-muted">
          Identities ready:{" "}
          <span className="text-white font-medium">
            {payload.identityFill.complete} / {payload.identityFill.target}
          </span>
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
            {payload.myIdentity.slotLabel}
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
              <h2 className="text-lg font-semibold text-white">1. Claim a division slot</h2>
              <p className="text-sm text-muted mt-1">
                First come, first served — tap any open marker on the map.
              </p>
            </div>

            <SdflFranchiseMap
              payload={payload}
              mySlotKey={mySlotKey}
              claimingKey={claimingKey}
              previewColor={hasClaimedSlot ? primaryColor : null}
              onClaimSlot={(slot) => void handleClaimSlot(slot)}
            />
          </section>

          {hasClaimedSlot && payload.myIdentity?.slotLabel ? (
            <section className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-white">
                  2. Build your franchise
                </h2>
                <p className="text-sm text-muted mt-1">
                  Claimed:{" "}
                  <span className="text-white font-medium">
                    {payload.myIdentity.slotLabel}
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
                    Cannot include real NFL nicknames (e.g. Chiefs, Cowboys).
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
              Claim a division slot above to continue with your city, team name, and
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
