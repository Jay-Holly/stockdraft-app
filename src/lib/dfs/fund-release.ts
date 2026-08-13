import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { isAuditGateEnabled } from "@/lib/dfs/audit-gate";

type ServiceClient = ReturnType<typeof createServiceClient>;

export type ReleaseResult = {
  auditDate: string;
  released: Array<{
    contestType: "sddfs" | "sdwfs";
    contestId: string;
    entriesPaid: number;
    totalReleased: number;
  }>;
  skipped: string[];
  blocked: string | null;
};

/**
 * Both rounds must be recorded as passed for the date. Anything else — still
 * running, failed, never run — leaves the money where it is.
 */
async function auditClearance(
  supabase: ServiceClient,
  auditDate: string
): Promise<{ cleared: boolean; reason: string | null }> {
  const { data: runs } = await supabase
    .from("dfs_audit_runs")
    .select("round, status, issues")
    .eq("audit_date", auditDate);

  const round1 = (runs ?? []).find((r) => r.round === 1);
  const round2 = (runs ?? []).find((r) => r.round === 2);

  if (!round1 || !round2) {
    return {
      cleared: false,
      reason: `Audit incomplete (round 1: ${round1?.status ?? "not run"}, round 2: ${round2?.status ?? "not run"})`,
    };
  }
  if (round1.status !== "passed" || round2.status !== "passed") {
    return {
      cleared: false,
      reason: `Audit did not pass (round 1: ${round1.status}, round 2: ${round2.status})`,
    };
  }
  return { cleared: true, reason: null };
}

/**
 * Credits the winners of every contest settled on `auditDate`, but only once
 * both audit rounds have passed for that date.
 *
 * The contest_fund_releases row is written BEFORE any wallet is credited. Its
 * unique (contest_type, contest_id) constraint is what makes this safe to
 * re-run: a second attempt collides on the insert and returns without paying
 * anyone twice, whether it came from a cron retry, an overlapping invocation,
 * or a manual trigger.
 */
export async function releaseFundsForDate(
  auditDate: string
): Promise<ReleaseResult> {
  const supabase = createServiceClient();
  const result: ReleaseResult = {
    auditDate,
    released: [],
    skipped: [],
    blocked: null,
  };

  // With the gate off, the 4 PM scoring run already credited these winners.
  // Paying here too would pay them twice, so this job does nothing at all
  // until the gate is deliberately switched on.
  if (!isAuditGateEnabled()) {
    result.blocked =
      "DFS_AUDIT_GATE is off — winners are credited at scoring time, nothing to release";
    return result;
  }

  const clearance = await auditClearance(supabase, auditDate);
  if (!clearance.cleared) {
    result.blocked = clearance.reason;
    console.error(`[dfs-release] holding funds for ${auditDate}: ${clearance.reason}`);
    return result;
  }

  const { data: sddfsContests } = await supabase
    .from("sddfs_contests")
    .select("id")
    .eq("contest_date", auditDate)
    .eq("status", "scored");

  const { data: sdwfsContests } = await supabase
    .from("sdwfs_contests")
    .select("id")
    .gte("score_at", `${auditDate}T00:00:00Z`)
    .lte("score_at", `${auditDate}T23:59:59Z`)
    .eq("status", "scored");

  const targets: Array<{ type: "sddfs" | "sdwfs"; id: string }> = [
    ...(sddfsContests ?? []).map((c) => ({ type: "sddfs" as const, id: c.id })),
    ...(sdwfsContests ?? []).map((c) => ({ type: "sdwfs" as const, id: c.id })),
  ];

  for (const target of targets) {
    const entryTable =
      target.type === "sddfs" ? "sddfs_entries" : "sdwfs_entries";

    const { data: entries } = await supabase
      .from(entryTable)
      .select("id, user_id, payout, final_rank")
      .eq("contest_id", target.id)
      .gt("payout", 0);

    const winners = entries ?? [];
    const totalReleased = winners.reduce(
      (sum, e) => sum + Number(e.payout ?? 0),
      0
    );

    // Claim the contest before paying. A duplicate key here means another run
    // already paid it out.
    const { error: claimError } = await supabase
      .from("contest_fund_releases")
      .insert({
        contest_type: target.type,
        contest_id: target.id,
        audit_date: auditDate,
        entries_paid: winners.length,
        total_released: totalReleased,
      });

    if (claimError) {
      if (claimError.code === "23505") {
        result.skipped.push(`${target.type} ${target.id} (already released)`);
      } else {
        result.skipped.push(
          `${target.type} ${target.id} (claim failed: ${claimError.message})`
        );
        console.error(
          `[dfs-release] could not claim ${target.type} ${target.id}:`,
          claimError.message
        );
      }
      continue;
    }

    for (const entry of winners) {
      const { error: walletError } = await supabase
        .from("wallet_transactions")
        .insert({
          user_id: entry.user_id,
          type: "win",
          amount: Number(entry.payout),
          status: "completed",
          description: `${target.type.toUpperCase()} contest win - Rank #${entry.final_rank}`,
        });

      if (walletError) {
        // The claim row stays, so this will not silently re-pay on the next
        // run — it needs a human to reconcile.
        console.error(
          `[dfs-release] FAILED to credit entry ${entry.id} (${target.type} ${target.id}): ${walletError.message}`
        );
      }
    }

    result.released.push({
      contestType: target.type,
      contestId: target.id,
      entriesPaid: winners.length,
      totalReleased,
    });

    console.log(
      `[dfs-release] ${target.type} ${target.id}: paid ${winners.length} winner(s), $${totalReleased.toFixed(2)}`
    );
  }

  return result;
}
