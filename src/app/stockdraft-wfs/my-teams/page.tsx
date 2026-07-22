import Link from "next/link";
import { WfsShell } from "@/components/dfs/WfsShell";
import { getMyWfsEntries } from "@/lib/wfs/my-teams";

function statusLabel(status: string) {
  if (status === "open") return "Open — editable until Monday lock";
  if (status === "locked") return "Locked — awaiting Friday close";
  return "Scored";
}

export default async function WfsMyTeamsPage() {
  const entries = await getMyWfsEntries();

  return (
    <WfsShell title="SDWFS — My Teams">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold">My Teams</h1>
          <p className="text-muted text-sm">
            Every SDWFS contest you&apos;ve entered will show up here.
          </p>
        </div>

        {entries.length === 0 ? (
          <div className="bg-dark-card border border-white/10 rounded-xl p-8 text-center text-muted">
            You haven&apos;t entered any SDWFS contests yet.
          </div>
        ) : (
          <div className="space-y-4">
            {entries.map((entry) => (
              <Link
                key={entry.entryId}
                href={`/stockdraft-wfs/entry/${entry.entryId}`}
                className="block bg-dark-card border border-white/10 rounded-xl p-4 hover:bg-white/5"
              >
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="font-semibold">{entry.contestName}</div>
                    <div className="text-xs text-muted">
                      ${entry.buyIn} — {entry.weekStartDate}
                    </div>
                    <div className="text-xs text-muted">
                      {statusLabel(entry.contestStatus)}
                    </div>
                  </div>
                  <div className="text-right">
                    {entry.finalRank ? (
                      <>
                        <div className="font-semibold text-gold">
                          #{entry.finalRank}
                        </div>
                        <div className="text-xs text-green-400">
                          ${entry.payout?.toFixed(2) ?? "0.00"}
                        </div>
                      </>
                    ) : (
                      <div className="text-xs text-muted">
                        {entry.picks.length} / 12 picks
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {entry.picks.map((pick) => (
                    <span
                      key={pick.sector}
                      className="text-xs bg-white/5 border border-white/10 rounded-full px-2 py-0.5"
                    >
                      {pick.symbol}
                      {pick.pctChange != null &&
                        ` ${pick.pctChange >= 0 ? "+" : ""}${pick.pctChange.toFixed(1)}%`}
                    </span>
                  ))}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </WfsShell>
  );
}
