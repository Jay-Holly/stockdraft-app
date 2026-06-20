export type MarketQuote = {
  symbol: string;
  price: number;
  changePercent: number;
  assetType: "stock" | "crypto";
  updatedAt: number;
};

export type MarketSession = "live" | "static";
