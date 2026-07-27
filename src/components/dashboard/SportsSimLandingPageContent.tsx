"use client";

import Link from "next/link";
import Image from "next/image";
import { SPORTS_LEAGUE_FORMATS } from "@/lib/league/league-config";
import type { HumanLeagueListItem } from "@/lib/league/human-league";

export function SportsSimLandingPageContent({
  leagues,
}: {
  leagues: HumanLeagueListItem[];
}) {
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

      <div className="grid grid-cols-2 gap-4">
        {SPORTS_LEAGUE_FORMATS.map((format) => {
          const teamCount = countByLeagueId[format.id] || 0;
          return (
            <Link
              key={format.id}
              href={`/dashboard/sports-sim?sport=${format.id}`}
              className="group relative block rounded-xl overflow-hidden transition-transform duration-300 hover:-translate-y-0.5 active:scale-[0.98]"
            >
              <div className="relative aspect-square bg-dark/40 border border-dark-border rounded-xl flex flex-col items-center justify-center p-1 group-hover:border-dark-border/60">
                {format.logoSrc && (
                  <div className="relative w-full flex-1 min-h-0 mb-1">
                    <Image
                      src={format.logoSrc}
                      alt={format.label}
                      fill
                      className="object-contain"
                    />
                  </div>
                )}
                <div className="text-center">
                  <p className="text-sm font-semibold">{format.label}</p>
                  <p className="text-xs text-muted mt-1">
                    {teamCount} {teamCount === 1 ? "team" : "teams"}
                  </p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
