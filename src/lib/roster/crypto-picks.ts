import type { DraftPick } from "@/lib/draft/types";

/** Crypto slot counts for scoring when it still holds budget or shares. */
export function isActiveCryptoPick(pick: {
  budget_spent: number;
  shares: number;
}): boolean {
  return pick.budget_spent > 0.01 || pick.shares > 0.000001;
}

export function isScoringRosterPick(pick: DraftPick): boolean {
  if (pick.pick_type === "stock") return true;
  if (pick.pick_type === "crypto") return isActiveCryptoPick(pick);
  return false;
}

export function filterScoringRosterPicks(picks: DraftPick[]): DraftPick[] {
  return picks.filter(isScoringRosterPick);
}

/** Baselines for stocks, bench, and active crypto only (excludes dead crypto shells). */
export function picksEligibleForWeekBaselines(picks: DraftPick[]): DraftPick[] {
  return picks.filter((pick) => {
    if (pick.pick_type === "skip") return false;
    if (pick.pick_type === "crypto") return isActiveCryptoPick(pick);
    return true;
  });
}
