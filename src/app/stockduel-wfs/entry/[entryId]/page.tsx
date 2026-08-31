import Image from "next/image";
import { notFound } from "next/navigation";
import { WfsShell } from "@/components/dfs/WfsShell";
import { WfsFreeAgentPanel } from "@/components/wfs/WfsFreeAgentPanel";
import { SdwfsRulesButton } from "@/components/wfs/SdwfsRulesButton";
import { getMyWfsEntries } from "@/lib/wfs/my-teams";
import { tierNameForBuyIn } from "@/lib/wfs/contests";
import { getSdwfsContestLeaderboard } from "@/lib/sdwfs/leaderboard";
import { createClient } from "@/lib/supabase/server";

function formatPct(pct: number | null) {
  if (pct == null) return "—";
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

export default async function WfsEntryLeaguePage({
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

  const entries = await getMyWfsEntries();
  const myEntry = entries.find((e) => e.entryId === entryId);

  // Viewing someone else's entry: look it up directly (RLS allows any
  // authenticated user to read any entry/picks within a contest) and reuse
  // the leaderboard row for their contest metadata + picks.
  let contestId = myEntry?.contestId;
  let contestName = myEntry?.contestName;
  let buyIn = myEntry?.buyIn;
  let weekStartDate = myEntry?.weekStartDate;
  let contestStatus = myEntry?.contestStatus;

  if (!myEntry) {
    const { data: otherEntry } = await supabase
      .from("sdwfs_entries")
      .select("id, contest_id, sdwfs_contests(buy_in, week_start_date, status)")
      .eq("id", entryId)
      .maybeSingle();

    if (!otherEntry) notFound();

    const contest = Array.isArray(otherEntry.sdwfs_contests)
      ? otherEntry.sdwfs_contests[0]
      : otherEntry.sdwfs_contests;
    if (!contest) notFound();

    contestId = otherEntry.contest_id;
    buyIn = Number(contest.buy_in);
    contestName = tierNameForBuyIn(buyIn);
    weekStartDate = contest.week_start_date;
    contestStatus = contest.status as typeof contestStatus;
  }

  if (!contestId) notFound();

  const { prizePool, isFinal, rows } = await getSdwfsContestLeaderboard(
    contestId,
    user.id
  );

  const viewedRow = rows.find((r) => r.entryId === entryId);
  const isViewingOwnEntry = viewedRow?.isMe ?? false;

  return (
    <WfsShell title={`SDWFS — ${contestName}`}>
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold">{contestName}</h1>
            <p className="text-muted text-sm">
              ${buyIn} buy-in — {weekStartDate} —{" "}
              {contestStatus === "open"
                ? "Open — editable until Monday 9:30 AM ET lock"
                : contestStatus === "locked"
                  ? "Locked — live standings below"
                  : "Final — contest scored"}
            </p>
            <div className="mt-2">
              <SdwfsRulesButton />
            </div>
          </div>
          <Image
            src="/images/leagues/sdwfs.png"
            alt="SDWFS"
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
                <a
                  key={row.entryId}
                  href={`/stockduel-wfs/entry/${row.entryId}`}
                  className={`flex items-center justify-between py-3 hover:bg-white/5 transition rounded-lg ${
                    row.isMe ? "bg-gold/5 -mx-4 px-4" : ""
                  } ${row.entryId === entryId ? "ring-1 ring-white/20 -mx-4 px-4" : ""}`}
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
                </a>
              ))
            )}
          </div>
        </div>

        <div className="bg-dark-card border border-white/10 rounded-xl p-4">
          <h2 className="font-semibold mb-3">
            {isViewingOwnEntry ? "Your Lineup" : `${viewedRow?.username ?? "Their"} Lineup`}
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {(viewedRow?.picks ?? myEntry?.picks ?? []).map((pick) => (
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

        {isViewingOwnEntry && myEntry && (
          <div>
            <h2 className="font-semibold mb-3">
              {myEntry.contestStatus === "open"
                ? "Free Agents — Make a Move"
                : "Free Agents"}
            </h2>
            {myEntry.contestStatus === "open" ? (
              <WfsFreeAgentPanel entries={[myEntry]} />
            ) : (
              <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center text-muted text-sm">
                This contest is {myEntry.contestStatus} — moves are no longer
                allowed.
              </div>
            )}
          </div>
        )}
      </div>
    </WfsShell>
  );
}
