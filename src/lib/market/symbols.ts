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

/** Legacy fallback — live pool comes from Supabase `crypto_pool`. */
export const LEGACY_CRYPTO_SYMBOLS = ["BTC", "ETH", "SOL", "DOGE"] as const;

export type StockSymbol = (typeof STOCK_SYMBOLS)[number];
export type CryptoSymbol = string;
export type DraftPoolSymbol = StockSymbol | CryptoSymbol;

export { getCryptoSymbols, isCryptoPoolSymbol } from "@/lib/crypto-pool/symbols";
