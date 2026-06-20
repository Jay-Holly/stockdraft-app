export const MIN_STOCK_PRICE_USD = 5;

/** Official GICS sectors used in the S&P 500 draft pool. */
export const DRAFT_POOL_SECTORS = [
  "All",
  "Technology",
  "Financials",
  "Healthcare",
  "Consumer Discretionary",
  "Consumer Staples",
  "Energy",
  "Industrials",
  "Materials",
  "Real Estate",
  "Utilities",
  "Communication Services",
] as const;

export type DraftPoolSector = (typeof DRAFT_POOL_SECTORS)[number];

export type DraftPoolStock = {
  symbol: string;
  name: string;
  sector: Exclude<DraftPoolSector, "All">;
  /** 1 = largest market cap in the S&P 500 pool. */
  marketCapRank?: number | null;
};

export type DraftPoolFilter = DraftPoolSector | "Top 100";

export const DRAFT_POOL_FILTER_BUTTONS = [
  "All",
  "Top 100",
  ...DRAFT_POOL_SECTORS.filter((s) => s !== "All"),
] as const;

export function filterDraftPoolStocks(
  stocks: DraftPoolStock[],
  options: {
    filter?: DraftPoolFilter;
    query?: string;
  }
): DraftPoolStock[] {
  const q = options.query?.trim().toLowerCase() ?? "";
  const filter = options.filter ?? "All";

  let result = stocks;

  if (filter === "Top 100") {
    result = stocks
      .filter(
        (stock) =>
          stock.marketCapRank != null &&
          stock.marketCapRank > 0 &&
          stock.marketCapRank <= 100
      )
      .sort(
        (a, b) =>
          (a.marketCapRank ?? Number.MAX_SAFE_INTEGER) -
          (b.marketCapRank ?? Number.MAX_SAFE_INTEGER)
      );
  } else {
    result = stocks.filter((stock) => {
      if (filter !== "All" && stock.sector !== filter) return false;
      return true;
    });
  }

  if (!q) return result;

  return result.filter(
    (stock) =>
      stock.symbol.toLowerCase().includes(q) ||
      stock.name.toLowerCase().includes(q)
  );
}

export function getTop100PoolSymbols(stocks: DraftPoolStock[]): string[] {
  return filterDraftPoolStocks(stocks, { filter: "Top 100" }).map((s) => s.symbol);
}

export const CRYPTO_DISPLAY_NAMES: Record<string, string> = {
  BTC: "Bitcoin",
  ETH: "Ethereum",
  SOL: "Solana",
  DOGE: "Dogecoin",
  XRP: "XRP",
};
