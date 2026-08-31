import Image from "next/image";
import Link from "next/link";
import {
  formatWfsContestWeekLabel,
  getWfsContestsForThisWeek,
} from "@/lib/wfs/contests";
import { WfsShell } from "@/components/dfs/WfsShell";
import { SdwfsRulesButton } from "@/components/wfs/SdwfsRulesButton";
import { createClient } from "@/lib/supabase/server";

/**
 * Never statically prerendered. it creates that week's contest rows and reads the viewer's own entries from
 * their auth cookie, so a build-time
 * prerender is both wrong (it would bake one moment, and one viewer's
 * state, into a static page) and impossible to do safely — the render
 * itself touches the database, and a build with no reachable database
 * fails outright. That is exactly what broke the build: the SDWFS lobby tried to
 * prerender, its database call failed, and the whole export aborted.
 */
export const dynamic = "force-dynamic";

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

  // Show every contest. Ones you haven't entered link to the lineup builder;
  // ones you're already in link to the big board. Filtering entered contests
  // out would leave their standings unreachable from the lobby.
  const contests = allContests;

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
            StockDuel Weekly Fantasy Sport
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
          {contests.map((contest) => {
            const canEnter =
              contest.status === "open" && !enteredContestIds.has(contest.id);

            return (
              <Link
                key={contest.id}
                href={
                  canEnter
                    ? `/stockduel-wfs/${contest.id}`
                    : `/stockduel-wfs/contests/${contest.id}`
                }
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
                    {canEnter ? "Enter →" : "View →"}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </WfsShell>
  );
}
