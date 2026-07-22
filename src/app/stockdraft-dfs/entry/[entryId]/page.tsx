import Image from "next/image";
import { notFound } from "next/navigation";
import { DfsShell } from "@/components/dfs/DfsShell";
import { FreeAgentPanel } from "@/components/dfs/FreeAgentPanel";
import { SddfsRulesButton } from "@/components/dfs/SddfsRulesButton";
import { getMyDfsEntries } from "@/lib/dfs/my-teams";
import { getSddfsContestLeaderboard } from "@/lib/sddfs/leaderboard";
import { createClient } from "@/lib/supabase/server";

function formatPct(pct: number | null) {
  if (pct == null) return "—";
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

export default async function DfsEntryLeaguePage({
  params,
}: {
  params: Promise<{ entryId: string }>;
}) {
  const { entryId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const entries = await getMyDfsEntries();
  const myEntry = entries.find((e) => e.entryId === entryId);
  if (!myEntry) notFound();

  const { prizePool, isFinal, rows } = await getSddfsContestLeaderboard(
    myEntry.contestId,
    user.id
  );

  return (
    <DfsShell title={`SDDFS — ${myEntry.contestName}`}>
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold">{myEntry.contestName}</h1>
            <p className="text-muted text-sm">
              ${myEntry.buyIn} buy-in — {myEntry.contestDate} —{" "}
              {myEntry.contestStatus === "open"
                ? "Open — editable until 9:00 AM ET lock"
                : myEntry.contestStatus === "locked"
                  ? "Locked — live standings below"
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
                <div
                  key={row.entryId}
                  className={`flex items-center justify-between py-3 ${
                    row.isMe ? "bg-gold/5 -mx-4 px-4 rounded-lg" : ""
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="w-6 text-center font-semibold text-muted">
                      #{row.rank}
                    </span>
                    <span className={row.isMe ? "font-semibold text-gold" : ""}>
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
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-dark-card border border-white/10 rounded-xl p-4">
          <h2 className="font-semibold mb-3">Your Lineup</h2>
          <div className="flex flex-wrap gap-1.5">
            {myEntry.picks.map((pick) => (
              <span
                key={pick.sector}
                className="text-xs bg-white/5 border border-white/10 rounded-full px-2 py-0.5"
              >
                {pick.symbol}
                {pick.pctChange != null && ` ${formatPct(pick.pctChange)}`}
              </span>
            ))}
          </div>
        </div>

        <div>
          <h2 className="font-semibold mb-3">
            {myEntry.contestStatus === "open"
              ? "Free Agents — Make a Move"
              : "Free Agents"}
          </h2>
          {myEntry.contestStatus === "open" ? (
            <FreeAgentPanel entries={[myEntry]} />
          ) : (
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center text-muted text-sm">
              This contest is {myEntry.contestStatus} — moves are no longer
              allowed.
            </div>
          )}
        </div>
      </div>
    </DfsShell>
  );
}
