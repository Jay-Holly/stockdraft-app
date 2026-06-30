import Link from "next/link";
import { Logo } from "@/components/Logo";
import { formatPct, formatSignedMoney } from "@/lib/format";
import type { DayTraderContestRow } from "@/lib/day-trader/types";
import type {
  DayTraderLeaderboardMetric,
  DayTraderLeaderboardRow,
} from "@/lib/day-trader/leaderboard";
import { formatDayTraderContestRange } from "@/lib/day-trader/resolve-contest";

type DayTraderLeaderboardViewProps = {
  metric: DayTraderLeaderboardMetric;
  contest: DayTraderContestRow | null;
  rows: DayTraderLeaderboardRow[];
  currentUserId: string | null;
};

function metricLabel(metric: DayTraderLeaderboardMetric): string {
  return metric === "dollar" ? "$ Gainer" : "% Gainer";
}

function formatScore(metric: DayTraderLeaderboardMetric, row: DayTraderLeaderboardRow) {
  return metric === "dollar"
    ? formatSignedMoney(row.dollarGain)
    : formatPct(row.percentGain);
}

function prizeText(
  contest: DayTraderContestRow | null,
  metric: DayTraderLeaderboardMetric
): string {
  if (!contest) return "";
  return metric === "dollar"
    ? contest.dollar_prize_text
    : contest.percent_prize_text;
}

export function DayTraderLeaderboardView({
  metric,
  contest,
  rows,
  currentUserId,
}: DayTraderLeaderboardViewProps) {
  const isLive = rows.some((row) => row.isLive);
  const prize = prizeText(contest, metric);

  return (
    <div className="min-h-screen px-4 py-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="text-center">
          <Logo size="lg" />
          <h1 className="text-xl font-bold mt-4">
            {contest?.contest_name ?? "Day Trader"} — {metricLabel(metric)}
          </h1>
          {contest ? (
            <p className="text-muted text-sm mt-2">
              {formatDayTraderContestRange(
                contest.week_start_at,
                contest.week_end_at
              )}
            </p>
          ) : (
            <p className="text-muted text-sm mt-2">No contest to rank yet.</p>
          )}
          {isLive ? (
            <p className="text-xs text-emerald-400 mt-2">Live marks — not final</p>
          ) : null}
        </div>

        <div className="flex rounded-xl border border-dark-border bg-dark/40 p-1">
          <Link
            href="/day-trader/leaderboard/dollar-gainer"
            className={`flex-1 rounded-lg px-3 py-2 text-center text-sm font-semibold transition-colors ${
              metric === "dollar"
                ? "bg-gold text-dark"
                : "text-muted hover:text-white"
            }`}
          >
            $ Gainer
          </Link>
          <Link
            href="/day-trader/leaderboard/percent-gainer"
            className={`flex-1 rounded-lg px-3 py-2 text-center text-sm font-semibold transition-colors ${
              metric === "percent"
                ? "bg-gold text-dark"
                : "text-muted hover:text-white"
            }`}
          >
            % Gainer
          </Link>
        </div>

        {prize ? (
          <div className="rounded-xl border border-gold/30 bg-gold/5 p-4 text-sm">
            <p className="text-xs text-muted uppercase tracking-wide mb-1">
              Prize
            </p>
            <p>{prize}</p>
          </div>
        ) : null}

        <div className="rounded-xl border border-dark-border bg-dark/40 overflow-hidden">
          {rows.length === 0 ? (
            <p className="p-4 text-sm text-muted">No entries yet this week.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dark-border text-left text-xs text-muted">
                  <th className="px-4 py-3 font-medium w-12">#</th>
                  <th className="px-4 py-3 font-medium">Player</th>
                  <th className="px-4 py-3 font-medium text-right">
                    {metric === "dollar" ? "$ Gain" : "% Gain"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isMe = currentUserId != null && row.userId === currentUserId;
                  const scoreClass =
                    row.score >= 0 ? "text-emerald-400" : "text-red-400";

                  return (
                    <tr
                      key={row.entryId}
                      className={`border-b border-dark-border/60 last:border-b-0 ${
                        isMe ? "bg-gold/10" : ""
                      }`}
                    >
                      <td className="px-4 py-3 font-semibold">{row.rank}</td>
                      <td className="px-4 py-3">
                        <p className="font-semibold">
                          {row.username}
                          {isMe ? (
                            <span className="ml-2 text-xs text-gold">You</span>
                          ) : null}
                        </p>
                        <p className="text-xs text-muted">{row.teamName}</p>
                      </td>
                      <td className={`px-4 py-3 text-right font-semibold ${scoreClass}`}>
                        {formatScore(metric, row)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <p className="text-xs text-muted text-center">
          Tied scores rank by earliest contest entry.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center text-sm">
          <Link href="/day-trader" className="text-muted hover:text-white text-center">
            Day Trader hub
          </Link>
          <Link href="/dashboard" className="text-muted hover:text-white text-center">
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
