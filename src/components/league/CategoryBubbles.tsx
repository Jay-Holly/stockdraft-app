"use client";

import Link from "next/link";
import { LEAGUE_THEMES, SPORTS_SIM_THEME_IDS, type LeagueThemeId } from "@/lib/league/league-config";

type Category = {
  href: string;
  label: string;
  subtitle: string;
  count: number;
  /** "sports-sim" has no single theme — it gets a segmented strip instead. */
  theme: LeagueThemeId | "sports-sim";
};

const SPORTS_SIM_STRIP = `linear-gradient(90deg, ${SPORTS_SIM_THEME_IDS.map(
  (id, i) =>
    `${LEAGUE_THEMES[id].primary} ${(i / SPORTS_SIM_THEME_IDS.length) * 100}%, ${
      LEAGUE_THEMES[id].primary
    } ${((i + 1) / SPORTS_SIM_THEME_IDS.length) * 100}%`
).join(", ")})`;

export function CategoryBubbles({
  simLeagueCount,
  playerLeagueCount,
  sportsSimLeagueCount,
  dayTraderActive,
}: {
  simLeagueCount: number;
  playerLeagueCount: number;
  sportsSimLeagueCount: number;
  dayTraderActive: boolean;
}) {
  const categories: Category[] = [
    {
      href: "/dashboard/sim-leagues",
      label: "Sim Leagues",
      subtitle: "vs. bot managers",
      count: simLeagueCount,
      theme: "sdai",
    },
    {
      href: "/dashboard/player-leagues",
      label: "Player Leagues",
      subtitle: "vs. real managers",
      count: playerLeagueCount,
      theme: "sdpl",
    },
    {
      href: "/dashboard/sports-sim",
      label: "Sports Sim",
      subtitle: "real athlete stocks",
      count: sportsSimLeagueCount,
      theme: "sports-sim",
    },
    {
      href: "/day-trader",
      label: "Day Trader",
      subtitle: "weekly contest",
      count: dayTraderActive ? 1 : 0,
      theme: "day-trader",
    },
  ];

  return (
    <div className="category-bubble-grid" role="navigation" aria-label="League categories">
      {categories.map((category) => (
        <Link
          key={category.href}
          href={category.href}
          className="category-bubble"
          data-league-theme={category.theme}
        >
          {category.theme === "sports-sim" && (
            <span
              className="category-bubble__strip"
              style={{ background: SPORTS_SIM_STRIP }}
              aria-hidden="true"
            />
          )}
          <span className="category-bubble__label">{category.label}</span>
          <span className="category-bubble__subtitle">{category.subtitle}</span>
          <span className="category-bubble__count">
            {category.count > 0
              ? `${category.count} active`
              : category.href === "/day-trader"
                ? "View"
                : "None yet"}
          </span>
        </Link>
      ))}
    </div>
  );
}
