import type { DraftPick } from "@/lib/draft/types";

/** Crypto slot counts for scoring when it still holds budget or shares. */
export function isActiveCryptoPick(pick: {
  budget_spent: number;
  shares: number;
}): boolean {
  return pick.budget_spent > 0.01 || pick.shares > 0.000001;
}

function pickUpdatedAtMs(pick: DraftPick): number {
  const parsed = Date.parse(pick.updated_at ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Prefer latest activity, then largest budget, then highest pick_order. */
export function isPreferredCryptoPick(a: DraftPick, b: DraftPick): boolean {
  const aTime = pickUpdatedAtMs(a);
  const bTime = pickUpdatedAtMs(b);
  if (aTime !== bTime) return aTime > bTime;
  if (a.budget_spent !== b.budget_spent) return a.budget_spent > b.budget_spent;
  return a.pick_order > b.pick_order;
}

/** One active crypto row per symbol (latest updated_at wins). */
export function canonicalActiveCryptoPicks(picks: DraftPick[]): DraftPick[] {
  const crypto = picks.filter(
    (pick) => pick.pick_type === "crypto" && isActiveCryptoPick(pick)
  );

  const bestBySymbol = new Map<string, DraftPick>();
  for (const pick of crypto) {
    const symbol = pick.symbol.toUpperCase();
    const existing = bestBySymbol.get(symbol);
    if (!existing || isPreferredCryptoPick(pick, existing)) {
      bestBySymbol.set(symbol, pick);
    }
  }

  return [...bestBySymbol.values()];
}

export function dedupeActiveCryptoPicksBySymbol(picks: DraftPick[]): DraftPick[] {
  const nonCrypto = picks.filter((pick) => pick.pick_type !== "crypto");
  return [...nonCrypto, ...canonicalActiveCryptoPicks(picks)];
}

/** Active crypto rows that lose the per-symbol canonical tie-break. */
export function staleDuplicateCryptoPickIds(picks: DraftPick[]): string[] {
  const crypto = picks.filter(
    (pick) => pick.pick_type === "crypto" && isActiveCryptoPick(pick)
  );
  const keepers = new Set(
    canonicalActiveCryptoPicks(picks).map((pick) => pick.id)
  );
  return crypto.filter((pick) => !keepers.has(pick.id)).map((pick) => pick.id);
}

export function findActiveCryptoPick(
  picks: DraftPick[],
  symbol: string,
  excludePickId?: string
): DraftPick | undefined {
  const upper = symbol.toUpperCase();
  const matches = picks.filter(
    (pick) =>
      pick.pick_type === "crypto" &&
      pick.id !== excludePickId &&
      pick.symbol.toUpperCase() === upper &&
      isActiveCryptoPick(pick)
  );

  if (matches.length === 0) return undefined;

  return matches.reduce((best, pick) =>
    isPreferredCryptoPick(pick, best) ? pick : best
  );
}

export function isScoringRosterPick(pick: DraftPick): boolean {
  if (pick.pick_type === "stock") return true;
  if (pick.pick_type === "crypto") return isActiveCryptoPick(pick);
  return false;
}

export function filterScoringRosterPicks(picks: DraftPick[]): DraftPick[] {
  return dedupeActiveCryptoPicksBySymbol(picks).filter(isScoringRosterPick);
}

/** Baselines for stocks, bench, and one active crypto row per symbol. */
export function picksEligibleForWeekBaselines(picks: DraftPick[]): DraftPick[] {
  return dedupeActiveCryptoPicksBySymbol(
    picks.filter((pick) => pick.pick_type !== "skip")
  ).filter((pick) => {
    if (pick.pick_type === "crypto") return isActiveCryptoPick(pick);
    return true;
  });
}
