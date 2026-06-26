import { fetchWithTimeout } from "@/lib/finnhub/service";

export type StockDetailProfile = {
  name: string;
  exchange: string;
  industry: string;
  country: string;
  currency: string;
  ipo: string | null;
  marketCapMillions: number | null;
  website: string | null;
  logo: string | null;
};

export type StockDetailMetrics = {
  peRatio: number | null;
  week52High: number | null;
  week52Low: number | null;
  profitMargin: number | null;
  revenueGrowth5Y: number | null;
  dividendYield: number | null;
  beta: number | null;
};

export type StockDetailCandles = {
  timestamps: number[];
  closes: number[];
};

export type StockDetailPayload = {
  profile: StockDetailProfile | null;
  metrics: StockDetailMetrics | null;
  candles: StockDetailCandles | null;
};

function getFinnhubKey(): string | undefined {
  return process.env.NEXT_PUBLIC_FINNHUB_KEY;
}

function readMetric(
  metric: Record<string, number | undefined> | undefined,
  key: string
): number | null {
  const value = metric?.[key];
  return value != null && Number.isFinite(value) ? value : null;
}

async function finnhubGet<T>(path: string, timeoutMs = 8000): Promise<T | null> {
  const token = getFinnhubKey();
  if (!token) return null;

  try {
    const response = await fetchWithTimeout(
      `https://finnhub.io/api/v1${path}${path.includes("?") ? "&" : "?"}token=${token}`,
      { cache: "no-store", timeoutMs }
    );

    if (!response.ok) {
      console.error(`Finnhub ${path} failed: HTTP ${response.status}`);
      return null;
    }

    return (await response.json()) as T;
  } catch (err) {
    console.error(`Finnhub ${path} error:`, err);
    return null;
  }
}

export async function fetchStockDetail(symbol: string): Promise<StockDetailPayload> {
  const normalized = symbol.trim().toUpperCase();
  const to = Math.floor(Date.now() / 1000);
  const from = to - 90 * 24 * 60 * 60;

  const [profileRaw, metricsRaw, candleRaw] = await Promise.all([
    finnhubGet<{
      name?: string;
      exchange?: string;
      finnhubIndustry?: string;
      country?: string;
      currency?: string;
      ipo?: string;
      marketCapitalization?: number;
      weburl?: string;
      logo?: string;
    }>(`/stock/profile2?symbol=${encodeURIComponent(normalized)}`),
    finnhubGet<{
      metric?: Record<string, number>;
    }>(`/stock/metric?symbol=${encodeURIComponent(normalized)}&metric=all`),
    finnhubGet<{
      s?: string;
      t?: number[];
      c?: number[];
    }>(
      `/stock/candle?symbol=${encodeURIComponent(normalized)}&resolution=D&from=${from}&to=${to}`
    ),
  ]);

  const profile: StockDetailProfile | null = profileRaw
    ? {
        name: profileRaw.name ?? normalized,
        exchange: profileRaw.exchange ?? "—",
        industry: profileRaw.finnhubIndustry ?? "—",
        country: profileRaw.country ?? "—",
        currency: profileRaw.currency ?? "USD",
        ipo: profileRaw.ipo ?? null,
        marketCapMillions: profileRaw.marketCapitalization ?? null,
        website: profileRaw.weburl ?? null,
        logo: profileRaw.logo ?? null,
      }
    : null;

  const metric = metricsRaw?.metric;
  const metrics: StockDetailMetrics | null = metric
    ? {
        peRatio:
          readMetric(metric, "peBasicExclExtraTTM") ??
          readMetric(metric, "peTTM"),
        week52High: readMetric(metric, "52WeekHigh"),
        week52Low: readMetric(metric, "52WeekLow"),
        profitMargin: readMetric(metric, "netProfitMarginTTM"),
        revenueGrowth5Y: readMetric(metric, "revenueGrowth5Y"),
        dividendYield: readMetric(metric, "currentDividendYieldTTM"),
        beta: readMetric(metric, "beta"),
      }
    : null;

  const candles: StockDetailCandles | null =
    candleRaw?.s === "ok" &&
    Array.isArray(candleRaw.t) &&
    Array.isArray(candleRaw.c) &&
    candleRaw.t.length > 0
      ? {
          timestamps: candleRaw.t,
          closes: candleRaw.c,
        }
      : null;

  return { profile, metrics, candles };
}

export function formatMarketCap(millions: number | null | undefined): string {
  if (millions == null || !Number.isFinite(millions)) return "—";
  if (millions >= 1_000_000) return `$${(millions / 1_000_000).toFixed(2)}T`;
  if (millions >= 1_000) return `$${(millions / 1_000).toFixed(2)}B`;
  return `$${millions.toFixed(0)}M`;
}

export function formatRatio(value: number | null | undefined, suffix = ""): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(2)}${suffix}`;
}

export function formatPercentRatio(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(2)}%`;
}
