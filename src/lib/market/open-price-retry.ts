import "server-only";

import { getNyDateString } from "@/lib/market/hours";
import { fetchContestAnchors } from "@/lib/pricing/contest-quotes";

/**
 * Opening prices for a contest lock — read from the price log.
 *
 * The name still says "with retry" because every caller does, but there is
 * nothing left to retry against. The old version called a provider, and when
 * the provider was slow or rate-limited at 9:30 it called again, and again,
 * inside the lock itself — which is how a lock could take minutes and still
 * end up with a mix of 9:30 and 9:34 prices in the same contest.
 *
 * The logger captures the open for the entire pool in one sweep and writes it
 * down. This reads that anchor. Every pick in every contest that locks on a
 * given day is therefore priced from the same observation, which is the
 * property that actually matters for fairness and which no amount of retrying
 * could give.
 *
 * If the open anchor is not in the log yet, this returns no price for that
 * symbol. It does NOT substitute the latest sample: a sample taken at 9:31 is
 * not the open, and a baseline is the one number a whole contest's scoring is
 * measured against. An absent baseline holds the contest; a plausible wrong
 * one silently misprices every entry in it.
 */
export async function getOpeningPricesWithRetry(
  symbols: string[],
  _options?: { isDailyContest?: boolean }
): Promise<Record<string, number>> {
  const unique = [...new Set((symbols ?? []).map((s) => String(s).toUpperCase()).filter(Boolean))];
  if (unique.length === 0) return {};

  const sessionDate = getNyDateString();
  return fetchContestAnchors(unique, sessionDate, "open", "contest-lock");
}
