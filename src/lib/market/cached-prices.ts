import "server-only";

import { createServiceClient } from "@/lib/supabase/service";

export type CachedQuote = {
  price: number;
  changePercent: number;
  prevClose: number;
  updatedAt: string | null;
};

export type ApiQuote = {
  price: number;
  prevClose: number;
  changePercent: number;
  updatedAt?: string | null;
};

function prevCloseFromQuote(price: number, changePercent: number): number {
  if (changePercent === 0 || price <= 0) return price;
  return price / (1 + changePercent / 100);
}

function mapRow(row: {
  symbol: string;
  price: number | string;
  change_percent: number | string;
  updated_at: string;
}): CachedQuote {
  const price = Number(row.price);
  const changePercent = Number(row.change_percent);
  return {
    price,
    changePercent,
    prevClose: prevCloseFromQuote(price, changePercent),
    updatedAt: row.updated_at,
  };
}

export function toApiQuote(quote: CachedQuote): ApiQuote {
  return {
    price: quote.price,
    prevClose: quote.prevClose,
    changePercent: quote.changePercent,
    updatedAt: quote.updatedAt,
  };
}

export async function fetchCachedStockQuotes(
  symbols: readonly string[]
): Promise<Record<string, CachedQuote>> {
  const unique = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))];
  if (unique.length === 0) return {};

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("stock_prices")
    .select("symbol, price, change_percent, updated_at")
    .in("symbol", unique);

  if (error || !data) return {};

  const quotes: Record<string, CachedQuote> = {};
  for (const row of data) {
    quotes[row.symbol.toUpperCase()] = mapRow(row);
  }
  return quotes;
}

export async function fetchCachedCryptoQuotes(
  symbols: readonly string[]
): Promise<Record<string, CachedQuote>> {
  const unique = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))];
  if (unique.length === 0) return {};

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("crypto_prices")
    .select("symbol, price, change_percent, updated_at")
    .in("symbol", unique);

  if (error || !data) return {};

  const quotes: Record<string, CachedQuote> = {};
  for (const row of data) {
    quotes[row.symbol.toUpperCase()] = mapRow(row);
  }
  return quotes;
}

export async function fetchAllCachedCryptoQuotes(): Promise<
  Record<string, CachedQuote>
> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("crypto_prices")
    .select("symbol, price, change_percent, updated_at");

  if (error || !data) return {};

  const quotes: Record<string, CachedQuote> = {};
  for (const row of data) {
    quotes[row.symbol.toUpperCase()] = mapRow(row);
  }
  return quotes;
}
