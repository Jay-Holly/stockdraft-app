import type { DraftPoolStock } from "@/lib/market/draft-pool";

export const HOMER_REGIONS = [
  "Bay Area",
  "New York",
  "Texas",
  "Midwest",
  "Southeast",
  "Pacific Northwest",
] as const;

export type HomerRegion = (typeof HOMER_REGIONS)[number];

/** HQ region for well-known S&P 500 names (approximate for draft logic). */
const SYMBOL_REGION: Partial<Record<string, HomerRegion>> = {
  AAPL: "Bay Area",
  GOOGL: "Bay Area",
  GOOG: "Bay Area",
  META: "Bay Area",
  NVDA: "Bay Area",
  INTC: "Bay Area",
  AMD: "Bay Area",
  CRM: "Bay Area",
  ORCL: "Bay Area",
  CSCO: "Bay Area",
  AVGO: "Bay Area",
  QCOM: "Bay Area",
  TXN: "Texas",
  AMAT: "Bay Area",
  ADI: "Bay Area",
  MU: "Bay Area",
  PANW: "Bay Area",
  NOW: "Bay Area",
  MSFT: "Pacific Northwest",
  AMZN: "Pacific Northwest",
  COST: "Pacific Northwest",
  SBUX: "Pacific Northwest",
  NKE: "Pacific Northwest",
  JPM: "New York",
  BAC: "New York",
  C: "New York",
  GS: "New York",
  MS: "New York",
  BLK: "New York",
  AXP: "New York",
  V: "New York",
  MA: "New York",
  SCHW: "Texas",
  WFC: "Bay Area",
  XOM: "Texas",
  CVX: "Texas",
  COP: "Texas",
  SLB: "Texas",
  HAL: "Texas",
  EOG: "Texas",
  PXD: "Texas",
  WMT: "Midwest",
  TGT: "Midwest",
  HD: "Southeast",
  LOW: "Southeast",
  KO: "Southeast",
  PEP: "Midwest",
  MCD: "Midwest",
  DIS: "Southeast",
  NEE: "Southeast",
  T: "Texas",
  VZ: "New York",
  CMCSA: "Midwest",
  PG: "Midwest",
  JNJ: "New York",
  UNH: "Midwest",
  PFE: "New York",
  MRK: "New York",
  ABBV: "Midwest",
  LLY: "Midwest",
  TMO: "New York",
  DHR: "Midwest",
  CAT: "Midwest",
  DE: "Midwest",
  GE: "New York",
  HON: "New York",
  UPS: "Southeast",
  FDX: "Southeast",
  BA: "Midwest",
  LMT: "Midwest",
  RTX: "New York",
  GM: "Midwest",
  F: "Midwest",
  TSLA: "Bay Area",
  PLTR: "Bay Area",
  COIN: "Bay Area",
  SOFI: "Bay Area",
};

const SECTOR_REGION_FALLBACK: Partial<
  Record<DraftPoolStock["sector"], HomerRegion>
> = {
  Technology: "Bay Area",
  Financials: "New York",
  Energy: "Texas",
  "Consumer Discretionary": "Midwest",
  "Consumer Staples": "Midwest",
  Healthcare: "New York",
  Industrials: "Midwest",
  Materials: "Midwest",
  "Real Estate": "New York",
  Utilities: "Southeast",
  "Communication Services": "New York",
};

export function getStockHomerRegion(
  stock: Pick<DraftPoolStock, "symbol" | "sector">
): HomerRegion {
  const mapped = SYMBOL_REGION[stock.symbol.toUpperCase()];
  if (mapped) return mapped;
  return SECTOR_REGION_FALLBACK[stock.sector] ?? "Midwest";
}

export function pickRandomHomerRegion(): HomerRegion {
  return HOMER_REGIONS[Math.floor(Math.random() * HOMER_REGIONS.length)];
}
