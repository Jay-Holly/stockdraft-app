import type { SupabaseClient } from "@supabase/supabase-js";
import { DRAFT_POOL_SECTORS } from "@/lib/market/draft-pool";

/** The 12 DFS lineup slots: every GICS sector plus Crypto. Shared by SDDFS and SDWFS. */
export const DFS_SECTORS = new Set([
  ...DRAFT_POOL_SECTORS.filter((s) => s !== "All"),
  "Crypto",
]);

/**
 * Confirms every submitted pick is a real, currently-tradeable symbol in its
 * declared sector before anything is charged or saved.
 *
 * The lineup builder already checks this client-side (DfsLineupBuilder's
 * applyPickList), but that only stops the UI path. Neither enter route checked
 * anything of its own — each would insert whatever {sector, symbol} pairs
 * arrived in the request body, so a direct POST could submit a symbol dropped
 * from the pool, a symbol in the wrong sector, or a duplicate sector. The only
 * thing that ever caught it was the lock's dead-ticker guard hours later,
 * after the entry fee was already charged. On 2026-08-17 that is exactly what
 * happened to EA in an SDDFS entry, replayed via "Use Yesterday's Lineup"
 * three days after it was pulled from draft_pool as a dead ticker.
 *
 * Call this before the entry is created and before the fee is charged, so a
 * bad lineup is rejected for free rather than refunded after the fact.
 */
export async function validateDfsPicks(
  supabase: SupabaseClient,
  picks: { sector: string; symbol: string }[]
): Promise<string | null> {
  const sectors = picks.map((p) => p.sector);
  const sectorSet = new Set(sectors);

  if (sectorSet.size !== sectors.length) {
    return "Your lineup has a duplicate sector.";
  }
  if (
    sectorSet.size !== DFS_SECTORS.size ||
    [...sectorSet].some((s) => !DFS_SECTORS.has(s))
  ) {
    return "Your lineup is missing a required sector.";
  }

  const stockPicks = picks.filter((p) => p.sector !== "Crypto");
  const cryptoPick = picks.find((p) => p.sector === "Crypto");

  const stockSymbols = stockPicks.map((p) => p.symbol.toUpperCase());
  if (new Set(stockSymbols).size !== stockSymbols.length) {
    return "Your lineup has the same stock picked twice.";
  }

  const { data: poolRows } = await supabase
    .from("draft_pool")
    .select("symbol, sector")
    .in("symbol", stockSymbols);

  const poolBySymbol = new Map(
    (poolRows ?? []).map((row) => [row.symbol.toUpperCase(), row.sector])
  );

  for (const pick of stockPicks) {
    const poolSector = poolBySymbol.get(pick.symbol.toUpperCase());
    if (!poolSector) {
      return `${pick.symbol} is no longer available. Pick a different stock for ${pick.sector}.`;
    }
    if (poolSector !== pick.sector) {
      return `${pick.symbol} isn't a ${pick.sector} stock.`;
    }
  }

  if (cryptoPick) {
    const { data: coinRow } = await supabase
      .from("crypto_pool")
      .select("symbol")
      .ilike("symbol", cryptoPick.symbol)
      .maybeSingle();

    if (!coinRow) {
      return `${cryptoPick.symbol} is no longer available. Pick a different coin for Crypto.`;
    }
  }

  return null;
}
