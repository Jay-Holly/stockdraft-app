import Image from "next/image";
import Link from "next/link";
import {
  formatWfsContestWeekLabel,
  getWfsContestsForThisWeek,
} from "@/lib/wfs/contests";
import { WfsShell } from "@/components/dfs/WfsShell";
import { SdwfsRulesButton } from "@/components/wfs/SdwfsRulesButton";
import { createClient } from "@/lib/supabase/server";

export default async function StockDraftWfsLobbyPage() {
  const allContests = await getWfsContestsForThisWeek();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let enteredContestIds = new Set<string>();
  if (user) {
    const { data: entries } = await supabase
      .from("sdwfs_entries")
      .select("contest_id")
      .eq("user_id", user.id)
      .in("contest_id", allContests.map((c) => c.id));
    enteredContestIds = new Set((entries ?? []).map((e) => e.contest_id));
  }

  const contests = allContests.filter((c) => !enteredContestIds.has(c.id));

  return (
    <WfsShell title="SDWFS" hideWatermark hideHeaderLogo>
      <div data-league-theme="sdwfs" className="max-w-lg mx-auto space-y-6">
        <div className="text-center">
          <Image
            src="/images/leagues/sdwfs.png"
            alt="SDWFS"
            width={260}
            height={260}
            className="mx-auto rounded-2xl"
            priority
          />
          <h1 className="text-xl font-bold mt-4">
            StockDraft Weekly Fantasy Sport
          </h1>
          <p className="text-muted text-sm mt-2">
            Pick one stock from each sector, build a 12-pick lineup, win a
            share of the prize pool over the week.
          </p>
          <div className="mt-3">
            <SdwfsRulesButton />
          </div>
        </div>

        {contests.length > 0 && (
          <p className="text-center text-xs font-semibold uppercase tracking-wider text-[var(--color-league-accent)]">
            {formatWfsContestWeekLabel(contests[0].weekStartDate)} Contests
          </p>
        )}

        <div className="space-y-3">
          {contests.map((contest) => (
            <Link
              key={contest.id}
              href={`/stockdraft-wfs/contests/${contest.id}`}
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
                  View →
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </WfsShell>
  );
}
