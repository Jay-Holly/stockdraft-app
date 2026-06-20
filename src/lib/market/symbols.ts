export const STOCK_SYMBOLS = [
  "NVDA",
  "AAPL",
  "MSFT",
  "TSLA",
  "GOOGL",
  "AMZN",
  "META",
  "NFLX",
  "AMD",
  "INTC",
  "PLTR",
  "SOFI",
  "SPCX",
  "FAC",
  "QS",
  "SLDP",
  "SES",
  "IONQ",
  "COIN",
  "DIS",
] as const;

export const CRYPTO_SYMBOLS = ["BTC", "ETH", "SOL", "DOGE"] as const;

export const CRYPTO_COINGECKO_IDS: Record<
  (typeof CRYPTO_SYMBOLS)[number],
  string
> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  DOGE: "dogecoin",
};

export const DRAFT_POOL_SYMBOLS = [...STOCK_SYMBOLS, ...CRYPTO_SYMBOLS] as const;

export type StockSymbol = (typeof STOCK_SYMBOLS)[number];
export type CryptoSymbol = (typeof CRYPTO_SYMBOLS)[number];
export type DraftPoolSymbol = (typeof DRAFT_POOL_SYMBOLS)[number];
