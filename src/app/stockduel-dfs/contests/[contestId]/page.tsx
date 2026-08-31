import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DfsShell } from "@/components/dfs/DfsShell";
import { ContestBigBoard } from "@/components/dfs/ContestBigBoard";
import { SddfsRulesButton } from "@/components/dfs/SddfsRulesButton";
import { DeleteSddfsEntryButton } from "@/components/dfs/DeleteSddfsEntryButton";
import { getDfsContestById, tierNameForBuyIn } from "@/lib/dfs/contests";
import { getSddfsContestLeaderboard } from "@/lib/sddfs/leaderboard";
import { createClient } from "@/lib/supabase/server";

export const revalidate = 60;

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

  // Check if user has an entry in this contest
  let userEntry = null;
  if (user) {
    const { data } = await supabase
      .from("sddfs_entries")
      .select("id")
      .eq("contest_id", contestId)
      .eq("user_id", user.id)
      .maybeSingle();
    userEntry = data;
  }

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
                ? "Open — live scoring updates every 30 seconds"
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

        {contest.status === "open" && (
          <div className="bg-gold/10 border border-gold/20 rounded-xl p-4">
            {userEntry ? (
              <DeleteSddfsEntryButton entryId={userEntry.id} />
            ) : (
              <p className="text-sm text-gold">
                Want to enter an upcoming contest?{" "}
                <Link
                  href="/stockduel-dfs"
                  className="font-semibold hover:underline"
                >
                  Go to the lobby →
                </Link>
              </p>
            )}
          </div>
        )}

        <div>
          <h2 className="font-semibold mb-4">Live Standings</h2>
          {rows.length === 0 ? (
            <div className="bg-dark-card border border-white/10 rounded-xl p-8 text-center text-muted">
              No entries yet.
            </div>
          ) : (
            <ContestBigBoard
              contestId={contestId}
              initialData={{ prizePool, isFinal, rows }}
              league="sddfs"
            />
          )}
        </div>
      </div>
    </DfsShell>
  );
}
