import { createClient } from "@/lib/supabase/server";
import type { DraftPoolStock } from "@/lib/market/draft-pool";
import { enrichDraftPoolStocks, getMarketCapRank } from "@/lib/market/draft-pool";

export async function fetchDraftPool(): Promise<DraftPoolStock[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("draft_pool")
    .select("symbol, name, sector")
    .order("symbol");

  if (error || !data) return [];
  return enrichDraftPoolStocks(
    data.map((row) => ({
      symbol: row.symbol.toUpperCase(),
      name: row.name,
      sector: row.sector as DraftPoolStock["sector"],
    }))
  );
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
