/**
 * Comparing two independent price sources.
 *
 * Pure on purpose, like lock-plan.ts and portfolio.ts: this decides whether a
 * price is corroborated, and that decision is the evidence a payout ultimately
 * rests on. It should be testable without a database or a network.
 */

/**
 * How far two sources may sit apart before it counts as disagreement rather
 * than timing noise.
 *
 * 3% matches the threshold the pre-rebuild audit used, and it was sized
 * against the real misses that system caught — a stored ETH close about 8% out
 * and a stored GOOGL open about 5% out. It is deliberately loose: two feeds
 * sampling moments apart, or one reporting an IEX-only print against a
 * consolidated close, legitimately differ by fractions of a percent. Tightening
 * this would flag normal behaviour as a fault and train everyone to ignore it.
 */
export const VERIFY_TOLERANCE_PCT = 3;

export type VerifyStatus = "ok" | "divergent" | "unverified" | "recovered";

export type Verification = {
  status: VerifyStatus;
  /** Signed difference of the second source against the primary, in percent. */
  diffPct: number | null;
  /** True when this anchor should spend a third source's limited budget. */
  needsThirdSource: boolean;
};

function usable(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * @param primary   the price being written as the anchor
 * @param secondary an independent source's price for the same instant, if any
 * @param fromFallback true when `primary` itself came from a fallback source
 *                     because the intended primary produced nothing
 */
export function verifyAnchor(
  primary: number | null | undefined,
  secondary: number | null | undefined,
  fromFallback = false
): Verification {
  if (!usable(primary)) {
    // Nothing to corroborate. The caller should not be writing an anchor at
    // all in this case — a missing price is a miss, never a verified zero.
    return { status: "unverified", diffPct: null, needsThirdSource: true };
  }

  if (!usable(secondary)) {
    // One source answered. That is not wrong, and it is not proof either.
    // Reported as single-sourced so the audit can decide, rather than being
    // quietly promoted to "verified" because nothing contradicted it.
    return {
      status: fromFallback ? "recovered" : "unverified",
      diffPct: null,
      needsThirdSource: true,
    };
  }

  const diffPct = ((secondary - primary) / primary) * 100;

  if (!Number.isFinite(diffPct)) {
    return { status: "unverified", diffPct: null, needsThirdSource: true };
  }

  const agreed = Math.abs(diffPct) <= VERIFY_TOLERANCE_PCT;
  return {
    status: agreed ? "ok" : "divergent",
    diffPct,
    needsThirdSource: !agreed,
  };
}
