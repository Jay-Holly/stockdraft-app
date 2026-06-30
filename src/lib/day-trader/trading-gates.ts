import "server-only";

import { getDayTraderContestContext } from "@/lib/day-trader/contest-access";
import { isDayTraderContestWindowOpen } from "@/lib/day-trader/contest-period";
import type { DayTraderContestRow, DayTraderEntryRow } from "@/lib/day-trader/types";
import { isUsMarketOpen } from "@/lib/market/hours";

export type DayTraderTradingContext =
  | {
      ok: true;
      contest: DayTraderContestRow;
      entry: DayTraderEntryRow;
    }
  | { ok: false; error: string };

export async function assertDayTraderTradingAllowed(
  userId: string,
  now: Date = new Date()
): Promise<DayTraderTradingContext> {
  if (!isDayTraderContestWindowOpen(now)) {
    return {
      ok: false,
      error: "Trading is only allowed Mon–Fri, 9:30 AM – 4:00 PM ET.",
    };
  }

  if (!isUsMarketOpen(now)) {
    return {
      ok: false,
      error: "Market is closed. Try again during regular trading hours.",
    };
  }

  const context = await getDayTraderContestContext(userId, now);
  if (!context.contest) {
    return { ok: false, error: "No open Day Trader contest this week." };
  }

  if (context.contest.status !== "open") {
    return { ok: false, error: "This week's contest is not open for trading." };
  }

  if (!context.entry) {
    return { ok: false, error: "Enter the contest before trading." };
  }

  return {
    ok: true,
    contest: context.contest,
    entry: context.entry,
  };
}
