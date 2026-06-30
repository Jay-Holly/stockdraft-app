import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import {
  loadDayTraderDollarLeaderboard,
  loadDayTraderPercentLeaderboard,
  type DayTraderLeaderboardMetric,
} from "@/lib/day-trader/leaderboard";
import { resolveDayTraderLeaderboardContest } from "@/lib/day-trader/resolve-contest";

export const dynamic = "force-dynamic";

function parseMetric(value: string | null): DayTraderLeaderboardMetric | null {
  if (value === "dollar" || value === "percent") return value;
  return null;
}

export async function GET(request: Request) {
  try {
    const { user } = await getAuthenticatedUserId();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const metric = parseMetric(searchParams.get("metric"));
    if (!metric) {
      return NextResponse.json(
        { error: "Query param metric must be dollar or percent." },
        { status: 400 }
      );
    }

    const contest = await resolveDayTraderLeaderboardContest(
      searchParams.get("contestId")
    );

    if (!contest) {
      return NextResponse.json({
        contest: null,
        metric,
        rows: [],
      });
    }

    const rows =
      metric === "dollar"
        ? await loadDayTraderDollarLeaderboard(contest.id)
        : await loadDayTraderPercentLeaderboard(contest.id);

    return NextResponse.json({
      contest,
      metric,
      rows,
    });
  } catch (error) {
    console.error("Day Trader leaderboard error:", error);
    return NextResponse.json(
      { error: "Could not load Day Trader leaderboard." },
      { status: 500 }
    );
  }
}
