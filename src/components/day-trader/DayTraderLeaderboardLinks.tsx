import { Button } from "@/components/Button";

export function DayTraderLeaderboardLinks() {
  return (
    <div className="rounded-xl border border-dark-border bg-dark/40 p-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Button
          href="/day-trader/leaderboard/dollar-gainer"
          variant="secondary"
          className="w-full text-sm"
        >
          $ Gainer leaderboard
        </Button>
        <Button
          href="/day-trader/leaderboard/percent-gainer"
          variant="secondary"
          className="w-full text-sm"
        >
          % Gainer leaderboard
        </Button>
      </div>
    </div>
  );
}
