import { isUsableQuote } from "@/lib/market/quote-guards";

/**
 * Valuing a roster, and measuring what it actually earned.
 *
 * This is the season-league and Day Trader equivalent of lib/dfs/lock-plan.ts,
 * and it is deliberately pure — no database, no network — for the same reason:
 * inside a settlement routine, the only way to test it is to settle a real
 * league in the production database.
 *
 * Two rules, both learned the expensive way.
 *
 * RULE 1 — A roster is valued completely, or not at all.
 *
 * A missing price does not value that holding at zero, and does not quietly
 * drop it from the total. Either produces a confident number that is wrong in
 * a way nobody can see: dropping a holding understates the roster, zeroing it
 * reports a wipeout that never happened. When a price is missing, this returns
 * a hold naming the symbols, and the caller settles nothing.
 *
 * RULE 2 — Money arriving in a portfolio is not performance.
 *
 * SDPL/SDAI weekly bonus awards deposit straight into the crypto flex pool
 * mid-week. A scorer that compares the end value to the start value reports
 * that deposit as skill: a manager who received $8,636 and traded badly can
 * outrank one who received nothing and traded well. Deposits are tracked
 * separately and subtracted from the gain, never counted as a gain.
 *
 * Cost basis needs no special handling here and that is intentional. Each pick
 * carries its own `shares`, computed at draft time from what THAT manager
 * actually paid, surcharge included. Valuing a pick as `shares x price` is
 * therefore already per-manager: the fourth buyer of a coin who paid a 15%
 * surcharge holds fewer shares for the same budget, and scores accordingly.
 * Nothing needs to look up a coin's generic price, and nothing should.
 */

export type ValuedPick = {
  pickId: string;
  symbol: string;
  shares: number;
  price: number;
  value: number;
};

export type RosterValuation =
  | {
      decision: "value";
      /** Total market value of every holding. */
      total: number;
      picks: ValuedPick[];
    }
  | {
      decision: "hold";
      /** Sorted, de-duplicated symbols with no usable price. */
      missingSymbols: string[];
    };

export type ValuablePick = {
  id: string;
  symbol: string;
  shares: number;
};

/**
 * Values every pick, or holds.
 *
 * A pick holding zero shares is valued at zero rather than held: zero shares
 * is a real, known quantity (a sold or emptied slot), not a missing price.
 */
export function valueRoster(
  picks: readonly ValuablePick[],
  prices: Readonly<Record<string, number>> | ReadonlyMap<string, number>
): RosterValuation {
  const priceOf = (symbol: string): number | undefined =>
    prices instanceof Map ? prices.get(symbol) : (prices as Record<string, number>)[symbol];

  const valued: ValuedPick[] = [];
  const missing = new Set<string>();

  for (const pick of picks) {
    const symbol = String(pick.symbol ?? "").toUpperCase();
    const shares = Number(pick.shares);

    if (!Number.isFinite(shares) || shares === 0) {
      valued.push({ pickId: pick.id, symbol, shares: 0, price: 0, value: 0 });
      continue;
    }

    const price = priceOf(symbol);
    if (!isUsableQuote(price)) {
      missing.add(symbol);
      continue;
    }

    valued.push({ pickId: pick.id, symbol, shares, price, value: shares * price });
  }

  if (missing.size > 0) {
    return { decision: "hold", missingSymbols: [...missing].sort() };
  }

  return {
    decision: "value",
    total: valued.reduce((sum, p) => sum + p.value, 0),
    picks: valued,
  };
}

export type PeriodGain = {
  /** What the roster actually earned, with deposits removed. */
  dollarGain: number;
  /** The same, as a percentage of the capital that was at work. */
  percentGain: number;
  /** Money deposited during the period. Reported, never counted as a gain. */
  moneyIn: number;
  openValue: number;
  closeValue: number;
};

/**
 * What a roster earned over a period.
 *
 * `moneyIn` is any capital that entered the portfolio during the period —
 * award payouts, bonus deposits — and it is removed from the gain before
 * anything is reported.
 *
 * The percentage divides by `openValue + moneyIn`: the capital that was
 * actually at work. That treats a deposit as if it had been available from the
 * start of the period, which slightly UNDERSTATES the return on a deposit that
 * arrived late. That direction is chosen on purpose — the alternative
 * overstates performance, and overstating is what decides a payout wrongly.
 *
 * A properly time-weighted return needs each deposit's timestamp, which the
 * payout tables do record. It can replace this later without changing any
 * caller; the shape here is already correct.
 */
export function computePeriodGain(input: {
  openValue: number;
  closeValue: number;
  moneyIn?: number;
}): PeriodGain {
  const openValue = Number(input.openValue);
  const closeValue = Number(input.closeValue);
  const moneyIn = Number(input.moneyIn ?? 0);

  const safeOpen = Number.isFinite(openValue) ? openValue : 0;
  const safeClose = Number.isFinite(closeValue) ? closeValue : 0;
  const safeMoneyIn = Number.isFinite(moneyIn) && moneyIn > 0 ? moneyIn : 0;

  const dollarGain = safeClose - safeOpen - safeMoneyIn;
  const capitalAtWork = safeOpen + safeMoneyIn;

  // No capital at work means no return to report. Zero, not Infinity, and not
  // a number derived from dividing by nothing.
  const percentGain = capitalAtWork > 0 ? (dollarGain / capitalAtWork) * 100 : 0;

  return {
    dollarGain,
    percentGain,
    moneyIn: safeMoneyIn,
    openValue: safeOpen,
    closeValue: safeClose,
  };
}
