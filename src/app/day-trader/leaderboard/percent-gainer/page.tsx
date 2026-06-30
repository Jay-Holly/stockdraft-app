import { redirect } from "next/navigation";
import { DayTraderLeaderboardView } from "@/components/day-trader/DayTraderLeaderboardView";
import { loadDayTraderLeaderboardPage } from "@/lib/day-trader/leaderboard-page";

type PageProps = {
  searchParams: Promise<{ contestId?: string }>;
};

export default async function DayTraderPercentGainerPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const { userId, contest, rows } = await loadDayTraderLeaderboardPage(
    "percent",
    params.contestId
  );

  if (!userId) {
    redirect("/auth?mode=daytrader");
  }

  return (
    <DayTraderLeaderboardView
      metric="percent"
      contest={contest}
      rows={rows}
      currentUserId={userId}
    />
  );
}
