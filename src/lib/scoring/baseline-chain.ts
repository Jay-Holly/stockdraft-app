import type { DraftPick } from "@/lib/draft/types";
import { computePickMarketValue, isTrustworthyValue } from "@/lib/scoring/values";

/**
 * THE CHAINING INVARIANT: a period's opening value is the previous period's
 * CLOSING value.
 *
 * Only a team's very first baseline of a season comes from a real quote. Every
 * one after it is carried forward.
 *
 * This is the rule that decides where overnight and weekend moves go. A stock
 * that closes Monday at $100 and opens Tuesday at $104 gapped up while the
 * market was shut. If Tuesday's baseline is captured from a live quote, that
 * $4 belongs to nobody — it vanishes from the game. Chaining puts it in
 * Tuesday's score, which is also how every finance site computes a daily move
 * (today's close against the previous close, not against today's open).
 *
 * Getting this wrong produces no error and no visible symptom. The numbers are
 * simply, permanently, too small — and across a season of gaps that is not a
 * rounding difference, it is most of the market's movement. It is the precise
 * failure shape this rebuild exists to eliminate: a silent, plausible,
 * confidently wrong number.
 *
 * Applies to every league that carries a portfolio across periods: SDFL and
 * SDPL week to week, SDAI and SDLB/SDHL/SDBA day to day. It does not apply to
 * SDDFS (locks and settles inside one day), SDWFS (one self-contained
 * Monday-to-Friday span) or Day Trader (intraday).
 *
 * ── The unit trap, which is easy to get wrong and expensive ────────────────
 *
 * A prior close is ALREADY A POSITION VALUE — dollars, the whole holding. It
 * carries across untouched. A live quote is a PRICE PER SHARE and has to be
 * multiplied by the shares held. Confusing the two turns an $80,000 position
 * into an opening value of about $348, and the period then scores as a total
 * wipeout. That comment is inherited from the pre-rebuild scorer, and it is
 * there because it happened.
 */

export type ChainedOpen = {
  pickId: string;
  symbol: string;
  openValue: number;
  /** Where the number came from — carried forward, or a first-ever quote. */
  from: "prior-close" | "quote" | "empty-slot";
};

export type HeldOpen = {
  pickId: string;
  symbol: string;
  reason: "no-prior-close-and-no-quote" | "untrustworthy-value";
};

export type BaselineChainPlan = {
  /** Baselines that may be written. */
  write: ChainedOpen[];
  /**
   * Picks that must NOT get a baseline this period. A held pick is not scored
   * rather than scored against a fabricated number; a later sweep picks it up
   * once a real value exists.
   */
  held: HeldOpen[];
};

export type ChainablePick = Pick<DraftPick, "id" | "symbol" | "shares">;

function isEmptySlot(pick: ChainablePick): boolean {
  return Number(pick.shares) <= 0 || String(pick.symbol).toUpperCase() === "__OPEN__";
}

/**
 * Decides this period's opening value for every pick that lacks one.
 *
 * @param priorCloseByPickId the previous period's closing VALUE per pick
 * @param quoteBySymbol      price PER SHARE, only consulted when a pick has no
 *                           prior close (its first baseline of the season)
 */
export function planPeriodOpenBaselines(
  picks: readonly ChainablePick[],
  priorCloseByPickId: ReadonlyMap<string, number>,
  quoteBySymbol: ReadonlyMap<string, number>
): BaselineChainPlan {
  const write: ChainedOpen[] = [];
  const held: HeldOpen[] = [];

  for (const pick of picks) {
    const symbol = String(pick.symbol ?? "").toUpperCase();
    const priorClose = priorCloseByPickId.get(pick.id);

    // 1. Carry forward. This is the normal path and it must win over any live
    //    quote that happens to be available — the whole point is that the
    //    period starts where the last one ended, not where the market is now.
    if (priorClose != null && Number.isFinite(priorClose)) {
      // A stored zero for a position that holds shares means a failed capture,
      // not a worthless holding. Carrying it forward would poison this period
      // and every season total that sums it, so the pick is held instead.
      if (!isTrustworthyValue(pick as DraftPick, priorClose)) {
        held.push({ pickId: pick.id, symbol, reason: "untrustworthy-value" });
        continue;
      }
      // Carried VERBATIM. Never multiplied by anything — it is already dollars.
      write.push({ pickId: pick.id, symbol, openValue: priorClose, from: "prior-close" });
      continue;
    }

    // 2. Genuinely empty slots really are worth nothing, and always have been.
    if (isEmptySlot(pick)) {
      write.push({ pickId: pick.id, symbol, openValue: 0, from: "empty-slot" });
      continue;
    }

    // 3. First baseline of the season: the one time a real quote is correct.
    const quote = quoteBySymbol.get(symbol);
    if (quote != null && Number.isFinite(quote) && quote > 0) {
      const openValue = computePickMarketValue(pick as DraftPick, quote);
      if (!isTrustworthyValue(pick as DraftPick, openValue)) {
        held.push({ pickId: pick.id, symbol, reason: "untrustworthy-value" });
        continue;
      }
      write.push({ pickId: pick.id, symbol, openValue, from: "quote" });
      continue;
    }

    // 4. Nothing to chain from and no usable quote. Write nothing.
    held.push({ pickId: pick.id, symbol, reason: "no-prior-close-and-no-quote" });
  }

  return { write, held };
}
