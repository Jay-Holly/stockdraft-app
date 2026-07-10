"use client";

import Link from "next/link";

type Category = {
  href: string;
  label: string;
  subtitle: string;
  count: number;
};

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
    },
    {
      href: "/dashboard/player-leagues",
      label: "Player Leagues",
      subtitle: "vs. real managers",
      count: playerLeagueCount,
    },
    {
      href: "/dashboard/sports-sim",
      label: "Sports Sim",
      subtitle: "real athlete stocks",
      count: sportsSimLeagueCount,
    },
    {
      href: "/day-trader",
      label: "Day Trader",
      subtitle: "weekly contest",
      count: dayTraderActive ? 1 : 0,
    },
  ];

  return (
    <div className="category-bubble-grid" role="navigation" aria-label="League categories">
      {categories.map((category) => (
        <Link
          key={category.href}
          href={category.href}
          className="category-bubble"
        >
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
