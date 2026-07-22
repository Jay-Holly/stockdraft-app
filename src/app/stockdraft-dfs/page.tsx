import Image from "next/image";
import Link from "next/link";
import { getDfsContestsForToday } from "@/lib/dfs/contests";
import { DfsShell } from "@/components/dfs/DfsShell";
import { SddfsRulesButton } from "@/components/dfs/SddfsRulesButton";

export default async function StockDraftDfsLobbyPage() {
  const contests = await getDfsContestsForToday();

  return (
    <DfsShell title="SDDFS" hideWatermark>
      <div data-league-theme="sddfs" className="max-w-lg mx-auto space-y-6">
        <div className="text-center">
          <Image
            src="/images/leagues/sddfs.png"
            alt="SDDFS"
            width={200}
            height={200}
            className="mx-auto rounded-2xl"
            priority
          />
          <h1 className="text-xl font-bold mt-4">SDDFS</h1>
          <p className="text-muted text-sm mt-2">
            Pick one stock from each sector, build a 12-pick lineup, win a
            share of the prize pool.
          </p>
          <div className="mt-3">
            <SddfsRulesButton />
          </div>
        </div>

        <div className="space-y-3">
          {contests.map((contest) => (
            <Link
              key={contest.id}
              href={`/stockdraft-dfs/${contest.id}`}
              className="block rounded-xl border border-[var(--color-league-accent)] bg-dark/40 p-4 hover:bg-white/5"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold">{contest.name}</div>
                  <div className="text-xs text-muted mt-1">
                    ${contest.buyIn} buy-in — {contest.entrants} /{" "}
                    {contest.maxEntrants} entered
                  </div>
                </div>
                <span className="text-[var(--color-league-accent)] text-sm font-medium">
                  Enter →
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </DfsShell>
  );
}
