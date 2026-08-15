type TradeHandler = (symbol: string, price: number) => void;

type FinnhubQuoteResponse = {
  c: number;
  pc: number;
  /** Unix seconds of the last trade — the tell for a symbol that no longer trades. */
  t?: number;
};

type FinnhubTradeMessage = {
  type: "trade" | "ping" | "error";
  data?: Array<{ s: string; p: number; t: number }>;
  msg?: string;
};

export type FinnhubQuote = {
  price: number;
  prevClose: number;
  changePercent: number;
};

export type FinnhubSearchResult = {
  symbol: string;
  description: string;
  displaySymbol: string;
  type: string;
  mic?: string;
};

export type FinnhubCompanyProfile = {
  name?: string;
  symbol?: string;
  [key: string]: unknown;
};

const US_MICS = new Set(["XNYS", "XNAS", "ARCX", "BATS", "XASE"]);

/**
 * Every leaderboard viewer's 30s auto-refresh independently called Finnhub
 * once per symbol with no sharing between requests — a locked contest with
 * a dozen viewers meant a dozen full re-fetches of the same symbols every
 * cycle, well past Finnhub's rate limit. Concurrent requests then got
 * inconsistent partial failures (different symbols 429'd for different
 * viewers), which is why two people looking at the same contest at the same
 * moment could see completely different scores. Sharing one short-lived
 * cache across all callers cuts real API calls roughly to "once per symbol
 * per window" instead of "once per symbol per viewer," and — just as
 * important — makes every concurrent viewer see the same numbers.
 */
const STOCK_QUOTE_CACHE_TTL_MS = 30_000;
const stockQuoteCache = new Map<string, { quote: FinnhubQuote; at: number }>();

function getFinnhubKey(): string | undefined {
  return process.env.NEXT_PUBLIC_FINNHUB_KEY;
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit & { timeoutMs?: number }
): Promise<Response> {
  const timeoutMs = init?.timeoutMs ?? 8000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const { timeoutMs: _timeoutMs, ...rest } = init ?? {};
    return await fetch(input, {
      ...rest,
      signal: rest.signal ?? controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function calcChangePercent(price: number, prevClose: number): number {
  if (!prevClose) return 0;
  return ((price - prevClose) / prevClose) * 100;
}

export class FinnhubService {
  private ws: WebSocket | null = null;
  private symbols = new Set<string>();
  private handlers = new Set<TradeHandler>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldConnect = false;

  connect() {
    const token = getFinnhubKey();
    if (!token || typeof window === "undefined") return;

    this.shouldConnect = true;

    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.ws = new WebSocket(`wss://ws.finnhub.io?token=${token}`);

    this.ws.onopen = () => {
      for (const symbol of this.symbols) {
        this.sendSubscribe(symbol);
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data as string) as FinnhubTradeMessage;
        if (message.type === "ping") return;
        if (message.type !== "trade" || !message.data) return;

        for (const trade of message.data) {
          for (const handler of this.handlers) {
            handler(trade.s, trade.p);
          }
        }
      } catch {
        // Ignore malformed websocket payloads.
      }
    };

    this.ws.onclose = () => {
      this.ws = null;
      if (this.shouldConnect) {
        this.reconnectTimer = setTimeout(() => this.connect(), 3000);
      }
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  disconnect() {
    this.shouldConnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  setSubscriptions(symbols: string[]) {
    const next = new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean));
    const toRemove = [...this.symbols].filter((s) => !next.has(s));
    const toAdd = [...next].filter((s) => !this.symbols.has(s));

    for (const symbol of toRemove) {
      this.symbols.delete(symbol);
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.sendUnsubscribe(symbol);
      }
    }

    for (const symbol of toAdd) {
      this.symbols.add(symbol);
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.sendSubscribe(symbol);
      }
    }
  }

  onTrade(handler: TradeHandler) {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  private sendSubscribe(symbol: string) {
    this.ws?.send(JSON.stringify({ type: "subscribe", symbol }));
  }

  private sendUnsubscribe(symbol: string) {
    this.ws?.send(JSON.stringify({ type: "unsubscribe", symbol }));
  }
}

let finnhubService: FinnhubService | null = null;

export function getFinnhubService(): FinnhubService {
  if (!finnhubService) {
    finnhubService = new FinnhubService();
  }
  return finnhubService;
}

export async function fetchFinnhubQuote(symbol: string): Promise<FinnhubQuote | null> {
  const quotes = await fetchFinnhubQuotes([symbol]);
  return quotes[symbol.toUpperCase()] ?? null;
}

/** Beyond a long weekend plus a holiday, a quote is not "today's" by any reading. */
const MAX_QUOTE_AGE_MS = 5 * 24 * 60 * 60 * 1000;

/**
 * Catches a symbol Finnhub still answers for but no longer actually trades.
 *
 * When a company re-tickers, the old symbol does not start erroring — it keeps
 * returning a full, plausible quote whose numbers simply stop moving. On
 * 2026-08-13 EchoStar traded as ECHO while SATS, its former ticker, still
 * returned a price: identical open and close all session, so a DFS pick on it
 * scored +0.00% while the stock actually fell 0.89%. Nothing upstream could
 * tell, because every field looked right.
 *
 * The tell is Finnhub's own trade timestamp. A live US equity stamps the last
 * trade — 20:00 UTC at the close, intraday while open. A dead symbol stamps
 * midnight UTC, which is not a time any US equity trades, so it is a
 * date-only placeholder rather than a real print.
 *
 * Refusing the quote is the point: the symbol goes unpriced, which is loud,
 * instead of being scored flat, which is silent. Fixing it properly means
 * re-mapping the ticker in the pool, and that needs a person.
 */
function isDeadTickerQuote(symbol: string, tradeTime: number | undefined): boolean {
  if (!tradeTime || !Number.isFinite(tradeTime)) return false;

  const stampedAt = new Date(tradeTime * 1000);
  const isMidnightUtc =
    stampedAt.getUTCHours() === 0 &&
    stampedAt.getUTCMinutes() === 0 &&
    stampedAt.getUTCSeconds() === 0;

  if (isMidnightUtc) {
    console.error(
      `[finnhub] ${symbol} quote is stamped midnight UTC (${stampedAt.toISOString()}) — no US equity trades then. Treating it as a dead ticker: the symbol has almost certainly been renamed and needs re-mapping in the pool.`
    );
    return true;
  }

  const age = Date.now() - stampedAt.getTime();
  if (age > MAX_QUOTE_AGE_MS) {
    console.error(
      `[finnhub] ${symbol} last traded ${stampedAt.toISOString()}, ${Math.round(age / 86_400_000)} days ago — refusing a quote this stale rather than scoring against it.`
    );
    return true;
  }

  return false;
}

export async function fetchFinnhubQuotes(
  symbols: readonly string[],
  options?: { cache?: RequestCache }
): Promise<Record<string, FinnhubQuote>> {
  const token = getFinnhubKey();
  if (!token || symbols.length === 0) return {};

  const fetchCache = options?.cache ?? "default";
  const unique = [...new Set(symbols.map((s) => s.toUpperCase()))];
  const quotes: Record<string, FinnhubQuote> = {};

  const now = Date.now();
  const stillNeeded: string[] = [];
  for (const symbol of unique) {
    const cached = stockQuoteCache.get(symbol);
    if (cached && now - cached.at < STOCK_QUOTE_CACHE_TTL_MS) {
      quotes[symbol] = cached.quote;
    } else {
      stillNeeded.push(symbol);
    }
  }

  const batchSize = 8;

  for (let i = 0; i < stillNeeded.length; i += batchSize) {
    const batch = stillNeeded.slice(i, i + batchSize);

    for (const symbol of batch) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await fetchWithTimeout(
            `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${token}`,
            { cache: fetchCache, timeoutMs: 5000 }
          );

          if (response.status === 429) {
            console.error(`Finnhub quote rate limited for ${symbol}`);
            await sleep(500);
            continue;
          }

          if (!response.ok) {
            console.error(
              `Finnhub quote failed for ${symbol}: HTTP ${response.status}`
            );
            await sleep(200);
            continue;
          }

          const data = (await response.json()) as FinnhubQuoteResponse;
          const price = data.c ?? 0;
          const prevClose = data.pc ?? price;

          if (price <= 0) {
            await sleep(200);
            continue;
          }

          if (isDeadTickerQuote(symbol, data.t)) {
            // Dropped rather than retried: asking again returns the same
            // frozen number, and the symbol needs a human to re-map it.
            break;
          }

          const quote = {
            price,
            prevClose,
            changePercent: calcChangePercent(price, prevClose),
          };
          quotes[symbol] = quote;
          stockQuoteCache.set(symbol, { quote, at: Date.now() });
          break;
        } catch (err) {
          console.error(`Finnhub quote error for ${symbol}:`, err);
          await sleep(200);
        }
      }
    }

    if (i + batchSize < stillNeeded.length) {
      await sleep(150);
    }
  }

  return quotes;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type FinnhubSymbolSearchResult =
  | { ok: true; results: FinnhubSearchResult[] }
  | { ok: false; error: string; status?: number };

export async function searchFinnhubSymbols(
  query: string
): Promise<FinnhubSymbolSearchResult> {
  const token = getFinnhubKey();
  if (!token) {
    return {
      ok: false,
      error:
        "Finnhub API key is missing — set NEXT_PUBLIC_FINNHUB_KEY on the server.",
    };
  }

  const trimmed = query.trim();
  if (trimmed.length < 1) {
    return { ok: true, results: [] };
  }

  try {
    const response = await fetchWithTimeout(
      `https://finnhub.io/api/v1/search?q=${encodeURIComponent(trimmed)}&token=${token}`,
      { cache: "no-store", timeoutMs: 5000 }
    );

    if (response.status === 429) {
      return {
        ok: false,
        error: "Finnhub rate limit hit — wait a few seconds and try again.",
        status: 429,
      };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        error: "Finnhub rejected the API key — check NEXT_PUBLIC_FINNHUB_KEY.",
        status: response.status,
      };
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(
        `Finnhub symbol search failed: HTTP ${response.status} ${body.slice(0, 200)}`
      );
      return {
        ok: false,
        error: "Finnhub symbol search failed — try again in a moment.",
        status: response.status,
      };
    }

    const data = (await response.json()) as { result?: FinnhubSearchResult[] };
    const results = data.result ?? [];

    const filtered = results
      .filter((item) => {
        const type = item.type?.toLowerCase() ?? "";
        if (!type.includes("stock") && type !== "common stock") return false;
        if (item.mic && !US_MICS.has(item.mic)) return false;
        if (!item.symbol) return false;
        return /^[A-Z.\-]{1,8}$/.test(item.symbol.toUpperCase());
      })
      .slice(0, 20)
      .map((item) => ({
        ...item,
        symbol: item.symbol.toUpperCase(),
      }));

    return { ok: true, results: filtered };
  } catch (err) {
    console.error("Finnhub symbol search error:", err);
    return {
      ok: false,
      error:
        err instanceof Error && err.name === "AbortError"
          ? "Finnhub search timed out — try a shorter or exact ticker."
          : "Finnhub search failed — try again.",
    };
  }
}

export async function fetchFinnhubCompanyProfiles(
  symbols: readonly string[]
): Promise<Record<string, string>> {
  const token = getFinnhubKey();
  if (!token || symbols.length === 0) return {};

  const unique = [...new Set(symbols.map((s) => s.toUpperCase()))];
  const names: Record<string, string> = {};

  const batchSize = 8;

  for (let i = 0; i < unique.length; i += batchSize) {
    const batch = unique.slice(i, i + batchSize);

    for (const symbol of batch) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await fetchWithTimeout(
            `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${token}`,
            { cache: "default", timeoutMs: 5000 }
          );

          if (response.status === 429) {
            console.error(`Finnhub profile rate limited for ${symbol}`);
            await sleep(500);
            continue;
          }

          if (!response.ok) {
            console.error(
              `Finnhub profile failed for ${symbol}: HTTP ${response.status}`
            );
            await sleep(200);
            continue;
          }

          const data = (await response.json()) as FinnhubCompanyProfile;
          if (data.name) {
            names[symbol] = data.name;
          }
          break;
        } catch (err) {
          console.error(`Finnhub profile error for ${symbol}:`, err);
          await sleep(200);
        }
      }
    }

    if (i + batchSize < unique.length) {
      await sleep(150);
    }
  }

  return names;
}
