/**
 * Draft engine completion / turn logic checks.
 * Run: npx --yes tsx scripts/test-draft-engine.ts
 */
import {
  getTurn,
  getDuplicateRosterError,
  hasRosterStructureComplete,
  isDraftComplete,
  isOpenPhaseComplete,
} from "../src/lib/draft/engine";
import type { Draft, DraftPick } from "../src/lib/draft/types";
import { CRYPTO_POOL, STOCK_BUDGET } from "../src/lib/draft/types";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exitCode = 1;
    throw new Error(message);
  }
  console.log("ok:", message);
}

function pick(
  partial: Partial<DraftPick> & Pick<DraftPick, "pick_type" | "symbol">
): DraftPick {
  const { pick_type, symbol, ...rest } = partial;
  return {
    id: "test",
    draft_id: "d1",
    user_id: "u1",
    round_number: 1,
    price_at_pick: 100,
    budget_spent: pick_type === "stock" ? STOCK_BUDGET : 0,
    shares: 0,
    surcharge_percent: 0,
    effective_value: 0,
    pick_order: 0,
    created_at: new Date().toISOString(),
    pick_type,
    symbol,
    ...rest,
  };
}

function draft(round: number, status: Draft["status"] = "in_progress"): Draft {
  return {
    id: "d1",
    user_id: "u1",
    league_id: "l1",
    status,
    current_round: round,
    pushback_skips_remaining: 0,
    created_at: new Date().toISOString(),
    completed_at: null,
  };
}

function tenStocks(): DraftPick[] {
  return Array.from({ length: 10 }, (_, i) =>
    pick({
      pick_type: "stock",
      symbol: `STK${i}`,
      pick_order: i,
      round_number: i + 1,
    })
  );
}

function twoBench(startOrder = 10): DraftPick[] {
  return [
    pick({
      pick_type: "bench",
      symbol: "BNCH1",
      budget_spent: 0,
      pick_order: startOrder,
      round_number: 14,
    }),
    pick({
      pick_type: "bench",
      symbol: "BNCH2",
      budget_spent: 0,
      pick_order: startOrder + 1,
      round_number: 15,
    }),
  ];
}

function cryptoSpend(amount: number, order: number, round = 5): DraftPick {
  return pick({
    pick_type: "crypto",
    symbol: "BTC",
    budget_spent: amount,
    pick_order: order,
    round_number: round,
  });
}

// 10 stock + 2 bench + $28K crypto left → NOT complete, crypto turn
{
  const picks = [
    ...tenStocks(),
    cryptoSpend(CRYPTO_POOL - 28_000, 10),
    ...twoBench(11),
  ];
  assert(!isDraftComplete(picks), "10+2 bench with $28K left is not complete");
  assert(hasRosterStructureComplete(picks), "roster structure is complete");
  const turn = getTurn(draft(15), picks);
  assert(turn.type === "crypto", "offers crypto turn after bench");
  assert(turn.canPickCrypto, "can pick crypto");
  assert(!turn.canPickStock, "cannot pick stock on crypto turn");
}

// 10 stock + 2 bench + $0 crypto → complete
{
  const picks = [
    ...tenStocks(),
    cryptoSpend(CRYPTO_POOL, 10),
    ...twoBench(11),
  ];
  assert(isDraftComplete(picks), "fully spent roster is complete");
  assert(getTurn(draft(15), picks).type === "complete", "turn is complete");
}

// 10 stock + 1 bench + $28K → bench turn, crypto allowed
{
  const picks = [
    ...tenStocks(),
    cryptoSpend(CRYPTO_POOL - 28_000, 10),
    twoBench(11)[0],
  ];
  assert(!isDraftComplete(picks), "one bench slot open");
  const turn = getTurn(draft(15), picks);
  assert(turn.type === "bench", "bench turn for second bench");
  assert(turn.canPickCrypto, "crypto allowed during bench");
  assert(turn.canPickStock, "bench stock allowed");
}

// Open phase ends after 10 stocks (crypto not required)
{
  const picks = tenStocks();
  assert(isOpenPhaseComplete(picks), "open phase complete at 10 stocks");
  assert(!isDraftComplete(picks), "draft not complete without bench+crypto");
}

// Sports-sim: crypto counts toward the same 10 open slots as stocks.
const SPORTS_SIM_RULES = "sports_sim" as const;

function sevenStocksThreeCrypto(): DraftPick[] {
  const stocks = Array.from({ length: 7 }, (_, i) =>
    pick({
      pick_type: "stock",
      symbol: `STK${i}`,
      pick_order: i,
      round_number: i + 1,
    })
  );
  const cryptos = Array.from({ length: 3 }, (_, i) =>
    pick({
      pick_type: "crypto",
      symbol: `COIN${i}`,
      budget_spent: STOCK_BUDGET,
      pick_order: 10 + i,
      round_number: 8 + i,
    })
  );
  return [...stocks, ...cryptos];
}

// 7 stock + 3 crypto + 2 bench → complete (no crypto flex phase)
{
  const picks = [...sevenStocksThreeCrypto(), ...twoBench(13)];
  assert(isDraftComplete(picks, SPORTS_SIM_RULES), "sports sim 10 open + 2 bench is complete");
  assert(getTurn(draft(15), picks, SPORTS_SIM_RULES).type === "complete", "sports sim turn complete");
}

// 7 stock + 2 crypto → open turn, both stock and crypto allowed
{
  const picks = sevenStocksThreeCrypto().slice(0, 9);
  const turn = getTurn(draft(9), picks, SPORTS_SIM_RULES);
  assert(turn.type === "open", "sports sim still in open phase");
  assert(turn.canPickStock, "sports sim can pick stock");
  assert(turn.canPickCrypto, "sports sim can pick crypto");
}

// Sports sim: duplicate crypto rejected
{
  const picks = [
    pick({
      pick_type: "crypto",
      symbol: "BTC",
      budget_spent: STOCK_BUDGET,
      pick_order: 0,
    }),
  ];
  assert(
    getDuplicateRosterError("BTC", picks, "crypto", SPORTS_SIM_RULES) !== null,
    "sports sim blocks duplicate crypto"
  );
  assert(
    getDuplicateRosterError("BTC", picks, "crypto", "standard") === null,
    "standard still allows duplicate crypto allocations"
  );
}

console.log(process.exitCode === 1 ? "\nSome tests failed." : "\nAll tests passed.");
