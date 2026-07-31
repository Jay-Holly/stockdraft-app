import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DfsShell } from "@/components/dfs/DfsShell";
import { SddfsRulesButton } from "@/components/dfs/SddfsRulesButton";
import { getDfsContestById, tierNameForBuyIn } from "@/lib/dfs/contests";
import { getSddfsContestLeaderboard } from "@/lib/sddfs/leaderboard";
import { createClient } from "@/lib/supabase/server";

export const revalidate = 300;

function formatPct(pct: number | null) {
  if (pct == null) return "—";
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

export default async function DfsContestBoardPage({
  params,
}: {
  params: Promise<{ contestId: string }>;
}) {
  const { contestId } = await params;

  const contest = await getDfsContestById(contestId);
  if (!contest) {
    notFound();
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { prizePool, isFinal, rows } = await getSddfsContestLeaderboard(
    contestId,
    user?.id ?? null
  );

  const contestName = tierNameForBuyIn(contest.buyIn);

  return (
    <DfsShell title={`SDDFS — ${contestName}`}>
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold">{contestName}</h1>
            <p className="text-muted text-sm">
              ${contest.buyIn} buy-in — {contest.contestDate} —{" "}
              {contest.status === "open"
                ? "Open — live scoring updates every 5 minutes"
                : contest.status === "locked"
                  ? "Locked — live standings"
                  : "Final — contest scored"}
            </p>
            <div className="mt-2">
              <SddfsRulesButton />
            </div>
          </div>
          <Image
            src="/images/leagues/sddfs.png"
            alt="SDDFS"
            width={180}
            height={180}
            className="rounded-xl flex-shrink-0 w-32 h-32 sm:w-44 sm:h-44"
          />
        </div>

        {!isFinal && (
          <div className="bg-gold/10 border border-gold/20 rounded-xl p-4">
            <p className="text-sm text-gold">
              Want to enter a contest for{" "}
              <Link
                href="/stockdraft-dfs"
                className="font-semibold hover:underline"
              >
                tomorrow's contests?
              </Link>
            </p>
          </div>
        )}

        <div className="bg-dark-card border border-white/10 rounded-xl p-4">
          <div className="flex items-center justify-between mb-1">
            <h2 className="font-semibold">Standings & Money Split</h2>
            <span className="text-xs text-muted">
              {isFinal ? "Final" : "Live projection"} — pool $
              {prizePool.toFixed(2)}
            </span>
          </div>
          <div className="divide-y divide-white/5">
            {rows.length === 0 ? (
              <p className="py-4 text-center text-muted text-sm">
                No entries yet.
              </p>
            ) : (
              rows.map((row) => (
                <Link
                  key={row.entryId}
                  href={`/stockdraft-dfs/entry/${row.entryId}`}
                  className="flex items-center justify-between py-3 hover:bg-white/5 transition rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-6 text-center font-semibold text-muted">
                      #{row.rank}
                    </span>
                    <span
                      className={row.isMe ? "font-semibold text-gold" : ""}
                    >
                      {row.isMe ? "You" : row.username}
                    </span>
                  </div>
                  <div className="text-right">
                    <div
                      className={
                        row.totalScore >= 0 ? "text-green-400" : "text-red-400"
                      }
                    >
                      {formatPct(row.totalScore)}
                    </div>
                    <div className="text-xs text-muted">
                      ${row.payout.toFixed(2)}
                      {!isFinal && row.payout > 0 ? " proj." : ""}
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>
    </DfsShell>
  );
}
