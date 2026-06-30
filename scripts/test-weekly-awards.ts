/**
 * Unit-style checks for weekly award scoring logic (no database).
 * Run: npx --yes tsx scripts/test-weekly-awards.ts
 */

import { computeWeeklyAwards } from "../src/lib/awards/compute";
import type { AwardPickMetric } from "../src/lib/awards/types";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const userA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const userB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function metric(
  partial: Omit<
    AwardPickMetric,
    "weekDollarGain" | "weekGainPct" | "stockValueAtFridayClose"
  > & {
    weekDollarGain?: number;
    weekGainPct?: number;
    stockValueAtFridayClose?: number | null;
  }
): AwardPickMetric {
  const weekDollarGain =
    partial.weekDollarGain ?? partial.valueAtClose - partial.valueAtOpen;
  const weekGainPct =
    partial.weekGainPct ??
    (partial.valueAtOpen > 0
      ? (weekDollarGain / partial.valueAtOpen) * 100
      : 0);

  return {
    ...partial,
    stockValueAtFridayClose: partial.stockValueAtFridayClose ?? null,
    weekDollarGain,
    weekGainPct,
  };
}

function starter(
  userId: string,
  pickId: string,
  symbol: string,
  open: number,
  close: number,
  fridayClose?: number | null
): AwardPickMetric {
  return metric({
    userId,
    pickId,
    pickType: "stock",
    symbol,
    valueAtOpen: open,
    valueAtClose: close,
    stockValueAtFridayClose: fridayClose ?? null,
  });
}

const metrics: AwardPickMetric[] = [
  starter(userA, "p1", "NVDA", 1000, 1200),
  starter(userA, "p2", "AMD", 1000, 900),
  metric({
    userId: userA,
    pickId: "p3",
    pickType: "crypto",
    symbol: "BTC",
    valueAtOpen: 500,
    valueAtClose: 550,
  }),
  metric({
    userId: userA,
    pickId: "p4",
    pickType: "bench",
    symbol: "SMCI",
    valueAtOpen: 200,
    valueAtClose: 400,
  }),
  starter(userB, "p5", "IONQ", 1000, 1300),
  starter(userB, "p6", "PLTR", 1000, 1100),
  ...Array.from({ length: 8 }, (_, index) =>
    starter(userB, `p7-${index}`, "MSFT", 1000, 1050)
  ),
  metric({
    userId: userB,
    pickId: "p8",
    pickType: "crypto",
    symbol: "ETH",
    valueAtOpen: 500,
    valueAtClose: 480,
  }),
  metric({
    userId: userB,
    pickId: "p9",
    pickType: "bench",
    symbol: "RIVN",
    valueAtOpen: 100,
    valueAtClose: 80,
  }),
];

const awards = computeWeeklyAwards(metrics);
const byKey = Object.fromEntries(awards.map((award) => [award.awardKey, award]));

assert(byKey.winner_of_week.winner?.userId === userB, "Winner of Week = userB");
assert(byKey.rookie_of_week.winner?.symbol === "IONQ", "Rookie = IONQ +30%");
assert(byKey.sweep_week.winner?.userId === userB, "Sweep Week = userB");
assert(byKey.bench_curse.winner?.userId === userA, "Bench Curse = userA");
assert(byKey.loser_of_week.winner?.userId === userA, "Loser of Week = userA");

console.log("weekly awards logic checks passed");
for (const award of awards) {
  console.log(
    `${award.awardKey}: ${award.winner?.userId ?? "none"} ${
      award.noWinnerReason ?? ""
    }`
  );
}
