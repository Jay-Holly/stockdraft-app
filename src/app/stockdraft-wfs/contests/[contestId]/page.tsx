import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { WfsShell } from "@/components/dfs/WfsShell";
import { ContestBigBoard } from "@/components/dfs/ContestBigBoard";
import { getSdwfsContestById, tierNameForBuyIn } from "@/lib/wfs/contests";
import { getSdwfsContestLeaderboard } from "@/lib/sdwfs/leaderboard";
import { createClient } from "@/lib/supabase/server";

export const revalidate = 60;

export default async function WfsContestBoardPage({
  params,
}: {
  params: Promise<{ contestId: string }>;
}) {
  const { contestId } = await params;

  const contest = await getSdwfsContestById(contestId);
  if (!contest) {
    notFound();
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { prizePool, isFinal, rows } = await getSdwfsContestLeaderboard(
    contestId,
    user?.id ?? null
  );

  const contestName = tierNameForBuyIn(contest.buyIn);

  return (
    <WfsShell title={`SDWFS — ${contestName}`}>
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold">{contestName}</h1>
            <p className="text-muted text-sm">
              ${contest.buyIn} buy-in — {contest.startDate} to {contest.endDate} —{" "}
              {contest.status === "active"
                ? "Active — live scoring updates every 30 seconds"
                : contest.status === "locked"
                  ? "Locked — final standings"
                  : "Completed — contest scored"}
            </p>
          </div>
          <Image
            src="/images/leagues/sdwfs.png"
            alt="SDWFS"
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
                href="/stockdraft-wfs"
                className="font-semibold hover:underline"
              >
                the next week's contests?
              </Link>
            </p>
          </div>
        )}

        <div>
          <h2 className="font-semibold mb-4">Live Standings</h2>
          {rows.length === 0 ? (
            <div className="bg-dark-card border border-white/10 rounded-xl p-8 text-center text-muted">
              No entries yet.
            </div>
          ) : (
            <ContestBigBoard contestId={contestId} initialData={{ prizePool, isFinal, rows }} />
          )}
        </div>
      </div>
    </WfsShell>
  );
}
