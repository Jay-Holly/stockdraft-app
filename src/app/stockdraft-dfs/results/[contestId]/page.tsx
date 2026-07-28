import Link from "next/link";
import { DfsShell } from "@/components/dfs/DfsShell";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { tierNameForBuyIn } from "@/lib/dfs/contests";

export default async function DfsResultsPage({
  params,
}: {
  params: { contestId: string };
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth?mode=login");

  // Get contest details
  const { data: contest, error: contestError } = await supabase
    .from("sddfs_contests")
    .select("id, contest_date, buy_in, status")
    .eq("id", params.contestId)
    .maybeSingle();

  if (contestError || !contest) {
    return (
      <DfsShell title="SDDFS — Results">
        <div className="text-red-400">Contest not found</div>
      </DfsShell>
    );
  }

  // Get all entries for this contest
  const { data: entries, error: entriesError } = await supabase
    .from("sddfs_entries")
    .select(
      "id, user_id, total_score, final_rank, payout, profiles(email)"
    )
    .eq("contest_id", params.contestId)
    .order("final_rank", { ascending: true, nullsFirst: false });

  if (entriesError || !entries) {
    return (
      <DfsShell title="SDDFS — Results">
        <div className="text-red-400">Failed to load results</div>
      </DfsShell>
    );
  }

  const contestName = tierNameForBuyIn(Number(contest.buy_in));
  const prizePool = Math.round(contest.buy_in * entries.length * 0.92 * 100) / 100;

  return (
    <DfsShell title="SDDFS — Results">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold">{contestName}</h1>
          <p className="text-muted text-sm mt-1">
            {contest.contest_date} · ${contest.buy_in} buy-in · Prize pool: ${prizePool.toFixed(2)}
          </p>
          <p className="text-muted text-sm">
            Status: <span className="capitalize">{contest.status}</span>
          </p>
        </div>

        {entries.length === 0 ? (
          <div className="bg-dark-card border border-white/10 rounded-xl p-8 text-center text-muted">
            No entries in this contest
          </div>
        ) : (
          <div className="space-y-2">
            <div className="bg-dark-card border border-white/10 rounded-xl p-4 hidden md:grid md:grid-cols-12 gap-4 text-xs font-semibold text-muted uppercase">
              <div className="md:col-span-1">Rank</div>
              <div className="md:col-span-6">Owner</div>
              <div className="md:col-span-3">Score</div>
              <div className="md:col-span-2">Payout</div>
            </div>

            {entries.map((entry) => {
              const profile = Array.isArray(entry.profiles)
                ? entry.profiles[0]
                : entry.profiles;
              const ownerName = profile?.email?.split("@")[0] ?? "Unknown";

              return (
                <Link
                  key={entry.id}
                  href={`/stockdraft-dfs/entry/${entry.id}`}
                  className="bg-dark-card border border-white/10 rounded-xl p-4 hover:bg-white/5 transition"
                >
                  <div className="grid md:grid-cols-12 gap-4 items-center">
                    <div className="md:col-span-1">
                      <div className="font-semibold text-lg">
                        {entry.final_rank ? `#${entry.final_rank}` : "—"}
                      </div>
                    </div>
                    <div className="md:col-span-6">
                      <div className="font-semibold text-base">{ownerName}</div>
                      <div className="text-xs text-muted">{profile?.email}</div>
                    </div>
                    <div className="md:col-span-3">
                      <div className="font-semibold">
                        {entry.total_score !== null
                          ? `${entry.total_score >= 0 ? "+" : ""}${entry.total_score.toFixed(2)}%`
                          : "—"}
                      </div>
                    </div>
                    <div className="md:col-span-2 text-right md:text-left">
                      <div className="font-semibold text-green-400">
                        ${entry.payout?.toFixed(2) ?? "0.00"}
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </DfsShell>
  );
}
