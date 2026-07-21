import { notFound } from "next/navigation";
import { getDfsContestById } from "@/lib/dfs/contests";
import { DfsLineupBuilder } from "@/components/dfs/DfsLineupBuilder";
import { DfsShell } from "@/components/dfs/DfsShell";

export default async function DfsContestDraftPage({
  params,
}: {
  params: Promise<{ contestId: string }>;
}) {
  const { contestId } = await params;
  const contest = await getDfsContestById(contestId);

  if (!contest) {
    notFound();
  }

  return (
    <DfsShell title={`SDDFS — $${contest.buyIn} Contest`}>
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold">${contest.buyIn} Contest</h1>
          <p className="text-muted text-sm">
            Pick one stock from each sector to build your 12-pick lineup.
          </p>
        </div>
        <DfsLineupBuilder contestId={contest.id} />
      </div>
    </DfsShell>
  );
}
