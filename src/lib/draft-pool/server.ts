import { createClient } from "@/lib/supabase/server";
import type { DraftPoolStock } from "@/lib/market/draft-pool";
import marketCapRanks from "@/data/sp500-market-cap-ranks.json";

const RANKS = marketCapRanks.ranks as Record<string, number>;

export async function fetchDraftPool(): Promise<DraftPoolStock[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("draft_pool")
    .select("symbol, name, sector")
    .order("symbol");

  if (error || !data) return [];
  return data.map((row) => {
    const symbol = row.symbol.toUpperCase();
    return {
      symbol,
      name: row.name,
      sector: row.sector as DraftPoolStock["sector"],
      marketCapRank: RANKS[symbol] ?? null,
    };
  });
}

export async function isDraftPoolStock(symbol: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("draft_pool")
    .select("symbol")
    .eq("symbol", symbol.toUpperCase())
    .maybeSingle();

  return Boolean(data);
}
