import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { formatWfsContestWeekLabel, getWfsContestById } from "@/lib/wfs/contests";
import { getMyWfsEntries } from "@/lib/wfs/my-teams";
import { WfsLineupBuilder } from "@/components/wfs/WfsLineupBuilder";
import { WfsShell } from "@/components/dfs/WfsShell";

export default async function WfsContestDraftPage({
  params,
}: {
  params: Promise<{ contestId: string }>;
}) {
  const { contestId } = await params;
  const contest = await getWfsContestById(contestId);

  if (!contest) {
    notFound();
  }

  const myEntries = await getMyWfsEntries();
  const existingEntry = myEntries.find((e) => e.contestId === contestId);
  if (existingEntry) {
    redirect(`/stockdraft-wfs/entry/${existingEntry.entryId}`);
  }

  if (contest.status !== "open") {
    return (
      <WfsShell title={`SDWFS — ${contest.name}`}>
        <div className="max-w-lg mx-auto space-y-4 text-center">
          <h1 className="text-3xl font-bold">{contest.name}</h1>
          <div className="rounded-xl border border-white/10 bg-dark-card p-6 text-muted">
            {contest.status === "locked"
              ? "This contest has already locked for the week — check back next week, or pick another contest that's still open."
              : "This contest has already been scored — pick another contest that's still open."}
          </div>
          <Link
            href="/stockdraft-wfs"
            className="inline-block text-sm text-gold hover:underline"
          >
            ← Back to lobby
          </Link>
        </div>
      </WfsShell>
    );
  }

  return (
    <WfsShell title={`SDWFS — ${contest.name}`}>
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold">{contest.name}</h1>
          <p className="text-muted text-sm">
            ${contest.buyIn} buy-in — {formatWfsContestWeekLabel(contest.weekStartDate)}{" "}
            — pick one stock from each sector to build your 12-pick lineup.
          </p>
        </div>
        <WfsLineupBuilder contestId={contest.id} />
      </div>
    </WfsShell>
  );
}
