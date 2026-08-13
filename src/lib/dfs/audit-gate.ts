import "server-only";

/**
 * Whether a scored contest has to wait for the nightly audit before its
 * winners are actually credited.
 *
 * Off by default, and deliberately its own switch rather than something that
 * turns itself on when an API key appears. Flipping this changes when real
 * money moves, so it should be a decision someone made, not a side effect of
 * configuring a data source.
 *
 * OFF (default) — contests credit winners at 4 PM, exactly as before. The
 *   audit still runs and still reports; it just isn't standing in front of
 *   the money.
 * ON — the 4 PM run scores, ranks and publishes standings but credits nobody.
 *   The release job pays out only after both audit rounds pass for that date.
 *
 * Before turning this on, both must be true or nothing will ever pay out:
 *   1. migration 085 applied (the audit and fund-release tables exist)
 *   2. TWELVE_DATA_API_KEY set (the audit has an independent source to check
 *      against — without one, every round fails closed by design)
 */
export function isAuditGateEnabled(): boolean {
  return process.env.DFS_AUDIT_GATE?.trim().toLowerCase() === "on";
}
