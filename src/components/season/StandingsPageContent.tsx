import { createClient } from "@/lib/supabase/server";
import { loadStandingSeeds } from "@/lib/matchup/league-teams";
import { sortStandingsForSeeding } from "@/lib/matchup/schedule";

function formatPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export async function StandingsPageContent({
  leagueId,
  currentUserId,
}: {
  leagueId: string;
  currentUserId: string;
}) {
  const supabase = await createClient();

  const seeds = await loadStandingSeeds(leagueId, supabase);

  if (seeds.length === 0) {
    return (
      <div className="rounded-2xl border border-dark-border bg-dark-card p-5 text-sm text-muted">
        Standings will appear once the season starts.
      </div>
    );
  }

  const { data: memberRows } = await supabase
    .from("league_members")
    .select("user_id, display_name")
    .eq("league_id", leagueId);

  const displayNameByUserId = new Map(
    (memberRows ?? []).map((row) => [row.user_id, row.display_name as string | null])
  );

  const ranked = sortStandingsForSeeding(seeds);

  return (
    <div className="rounded-2xl border border-dark-border bg-dark-card overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-dark-border text-left text-xs uppercase tracking-wider text-muted">
            <th className="px-4 py-3 font-semibold">#</th>
            <th className="px-4 py-3 font-semibold">Team</th>
            <th className="px-4 py-3 font-semibold text-right">W</th>
            <th className="px-4 py-3 font-semibold text-right">L</th>
            <th className="px-4 py-3 font-semibold text-right">Season %</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((seed, index) => {
            const isMe = seed.userId === currentUserId;
            const name = displayNameByUserId.get(seed.userId) ?? "Team";
            return (
              <tr
                key={seed.userId}
                className={[
                  "border-b border-dark-border/60 last:border-b-0",
                  isMe ? "bg-gold/5" : "",
                ].join(" ")}
              >
                <td className="px-4 py-3 text-muted">{index + 1}</td>
                <td className="px-4 py-3 font-medium text-white">
                  {name}
                  {isMe && (
                    <span className="ml-2 text-xs text-gold font-semibold">
                      YOU
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-white">{seed.wins}</td>
                <td className="px-4 py-3 text-right text-white">{seed.losses}</td>
                <td
                  className={[
                    "px-4 py-3 text-right font-medium",
                    seed.seasonGainPercent > 0
                      ? "text-green-400"
                      : seed.seasonGainPercent < 0
                        ? "text-red-400"
                        : "text-muted",
                  ].join(" ")}
                >
                  {formatPercent(seed.seasonGainPercent)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
