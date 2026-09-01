"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { SPORTS_LEAGUE_FORMATS } from "@/lib/league/league-config";
import type { HumanLeagueListItem } from "@/lib/league/human-league";
import { LeagueRulesModal } from "@/components/league/LeagueRulesModal";
import {
  SdflRulesContent,
  SdlbSdhlSdbaRulesContent,
} from "@/components/league/rules-content";

export function SportsSimLandingPageContent({
  leagues,
}: {
  leagues: HumanLeagueListItem[];
}) {
  const [rulesFor, setRulesFor] = useState<"sdfl" | "shared" | null>(null);
  const countByLeagueId: Record<string, number> = {};

  for (const item of leagues) {
    const sportsLeagueId = item.league.sports_league_id || "unknown";
    countByLeagueId[sportsLeagueId] = (countByLeagueId[sportsLeagueId] || 0) + 1;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Sports Sim Leagues</h1>
        <p className="text-muted text-sm mt-1">
          Choose a sport to view your teams.
        </p>
      </div>

      {rulesFor === "sdfl" && (
        <LeagueRulesModal title="SDFL Rules" onClose={() => setRulesFor(null)}>
          <SdflRulesContent />
        </LeagueRulesModal>
      )}
      {rulesFor === "shared" && (
        <LeagueRulesModal
          title="SDLB / SDHL / SDBA Rules"
          onClose={() => setRulesFor(null)}
        >
          <SdlbSdhlSdbaRulesContent />
        </LeagueRulesModal>
      )}

      <div className="grid grid-cols-2 gap-3">
        {SPORTS_LEAGUE_FORMATS.map((format) => {
          const teamCount = countByLeagueId[format.id] || 0;
          const comingSoon =
        format.id === "sdhl" ||
        format.id === "sdba" ||
        format.id === "sdcup" ||
        format.id === "sdps";
          const comingNextSpring = format.id === "sdlb";
          const signUpNow = format.id === "sdfl";
          return (
            <div
              key={format.id}
              className="rounded-xl border border-dark-border bg-dark/40 p-3 pb-2 text-center"
            >
              <Link href={`/dashboard/sports-sim?sport=${format.id}`}>
                {format.logoSrc ? (
                  <Image
                    src={format.logoSrc}
                    alt=""
                    width={160}
                    height={200}
                    className="mx-auto -mb-1 rounded-lg w-full h-auto max-w-[160px]"
                  />
                ) : (
                  <span className="mx-auto -mb-1 flex h-[200px] w-full max-w-[160px] items-center justify-center rounded border border-dashed border-dark-border text-xs text-muted">
                    {format.label}
                  </span>
                )}
                <span className="block text-sm font-semibold">{format.label}</span>
                <span className="block text-[0.6875rem] mt-0.5 text-muted">
                  {teamCount} {teamCount === 1 ? "team" : "teams"}
                </span>
              </Link>
              {comingSoon && (
                <span className="block text-[0.6875rem] font-semibold mt-1 text-gold">
                  Coming Soon
                </span>
              )}
              {comingNextSpring && (
                <span className="block text-[0.6875rem] font-semibold mt-1 text-gold">
                  Coming Spring 2027
                </span>
              )}
              {signUpNow && (
                <span className="block text-[0.6875rem] font-semibold mt-1 text-emerald-400">
                  Sign Up Now
                </span>
              )}
              <button
                type="button"
                onClick={() => setRulesFor(format.id === "sdfl" ? "sdfl" : "shared")}
                className="block w-full text-[0.6875rem] font-medium text-gold hover:underline mt-1.5"
              >
                Rules
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
