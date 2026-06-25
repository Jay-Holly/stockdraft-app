import "server-only";

import { createServiceClient } from "@/lib/supabase/service";

export type StockPriceUpsertRow = {
  symbol: string;
  price: number;
  changePercent: number;
};

/** Best-effort write of live quotes into stock_prices (service role). */
export async function upsertStockPriceCache(
  rows: StockPriceUpsertRow[]
): Promise<void> {
  if (rows.length === 0) return;

  try {
    const supabase = createServiceClient();
    const now = new Date().toISOString();

    const { error } = await supabase.from("stock_prices").upsert(
      rows.map((row) => ({
        symbol: row.symbol.toUpperCase(),
        price: row.price,
        change_percent: row.changePercent,
        updated_at: now,
      })),
      { onConflict: "symbol" }
    );

    if (error) {
      console.error("upsertStockPriceCache failed:", error.message);
    }
  } catch (err) {
    console.warn(
      "upsertStockPriceCache skipped:",
      err instanceof Error ? err.message : err
    );
  }
}
