import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { formatDfsContestDateLabel, getDfsContestById } from "@/lib/dfs/contests";
import { getMyDfsEntries } from "@/lib/dfs/my-teams";
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

  const myEntries = await getMyDfsEntries();
  const existingEntry = myEntries.find((e) => e.contestId === contestId);
  if (existingEntry) {
    redirect(`/stockdraft-dfs/entry/${existingEntry.entryId}`);
  }

  if (contest.status !== "open") {
    return (
      <DfsShell title={`SDDFS — ${contest.name}`}>
        <div className="max-w-lg mx-auto space-y-4 text-center">
          <h1 className="text-3xl font-bold">{contest.name}</h1>
          <div className="rounded-xl border border-white/10 bg-dark-card p-6 text-muted">
            {contest.status === "locked"
              ? "This contest has already locked for the day — check back tomorrow, or pick another contest that's still open."
              : "This contest has already been scored — pick another contest that's still open."}
          </div>
          <Link
            href="/stockdraft-dfs"
            className="inline-block text-sm text-gold hover:underline"
          >
            ← Back to lobby
          </Link>
        </div>
      </DfsShell>
    );
  }

  return (
    <DfsShell title={`SDDFS — ${contest.name}`}>
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold">{contest.name}</h1>
          <p className="text-muted text-sm">
            ${contest.buyIn} buy-in — {formatDfsContestDateLabel(contest.contestDate)}{" "}
            — pick one stock from each sector to build your 12-pick lineup.
          </p>
        </div>
        <DfsLineupBuilder contestId={contest.id} />
      </div>
    </DfsShell>
  );
}
