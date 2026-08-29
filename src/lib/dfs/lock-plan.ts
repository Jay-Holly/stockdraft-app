import { isUsableQuote } from "@/lib/market/quote-guards";

/**
 * Decides whether a DFS contest may lock, given the opening prices available
 * for its picks.
 *
 * This lives on its own, apart from the lifecycle that uses it, for one
 * reason: it is the decision that determines whether a contest scores
 * honestly or corrupts every result it will ever produce, and inside the
 * lifecycle it could only be tested by locking a real contest in the
 * production database. Here it can be tested directly, which is the whole
 * point — the bug it prevents typechecked cleanly for months.
 *
 * The rule: a contest locks only when EVERY pick has a usable opening price.
 *
 * The per-pick guard in the old code was already correct — it refused to
 * store a baseline it didn't trust. What was missing was anyone asking, after
 * the loop, whether any baselines had actually been stored. The answer could
 * be "none at all" and the contest was marked locked regardless. A null
 * baseline scores its pick neutral, so the whole field finished flat, tied,
 * and paid out on it.
 *
 * Partial coverage is held for the same reason, not merely as caution:
 * pricing 39 of 40 symbols scores the 40th neutral while its rivals score for
 * real, which misprices every entry holding it relative to every entry that
 * doesn't. That is not a smaller version of the problem, it is the same
 * problem affecting fewer people, and it is harder to notice.
 *
 * Holding is recoverable and locking is not: a contest that hasn't locked can
 * still lock on a later tick once the price arrives, but a contest locked on
 * missing baselines has already fixed a wrong number as the thing every score
 * is measured against.
 */
export type ContestLockPlan =
  | {
      decision: "lock";
      /** Pick ids grouped by the open price to write, one UPDATE per price. */
      picksByPrice: Map<number, string[]>;
    }
  | {
      decision: "hold";
      /** Sorted, de-duplicated symbols with no usable opening price. */
      missingSymbols: string[];
    };

export type LockablePick = {
  id: string;
  symbol: string;
};

export function planContestLock(
  picks: readonly LockablePick[],
  prices: Readonly<Record<string, number>>
): ContestLockPlan {
  const picksByPrice = new Map<number, string[]>();
  const unpriced = new Set<string>();

  for (const pick of picks) {
    const symbol = String(pick.symbol ?? "").toUpperCase();
    const openPrice = prices[symbol];

    // Never persist a baseline we don't trust — every later score is measured
    // against it.
    if (!isUsableQuote(openPrice)) {
      unpriced.add(symbol);
      continue;
    }

    const ids = picksByPrice.get(openPrice) ?? [];
    ids.push(pick.id);
    picksByPrice.set(openPrice, ids);
  }

  if (unpriced.size > 0) {
    return { decision: "hold", missingSymbols: [...unpriced].sort() };
  }

  // A contest with no picks has nothing to price and nothing to get wrong.
  return { decision: "lock", picksByPrice };
}
