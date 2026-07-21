import Link from "next/link";
import { getDfsContestsForToday } from "@/lib/dfs/contests";
import { DfsShell } from "@/components/dfs/DfsShell";

export default async function StockDraftDfsLobbyPage() {
  const contests = await getDfsContestsForToday();

  return (
    <DfsShell title="SDDFS">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold">SDDFS</h1>
          <p className="text-muted text-sm">
            Pick one stock from each sector, build a 12-pick lineup, win a
            share of the prize pool.
          </p>
        </div>

        <div className="bg-dark-card border border-white/10 rounded-xl divide-y divide-white/5">
          {contests.map((contest) => (
            <Link
              key={contest.id}
              href={`/stockdraft-dfs/${contest.id}`}
              className="flex items-center justify-between p-4 hover:bg-white/5"
            >
              <div>
                <div className="font-semibold">${contest.buyIn} Contest</div>
                <div className="text-xs text-muted">
                  {contest.entrants} / {contest.maxEntrants} entered
                </div>
              </div>
              <span className="text-gold text-sm font-medium">Enter →</span>
            </Link>
          ))}
        </div>
      </div>
    </DfsShell>
  );
}
