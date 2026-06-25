type TradeHandler = (symbol: string, price: number) => void;

type FinnhubQuoteResponse = {
  c: number;
  pc: number;
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

const US_MICS = new Set(["XNYS", "XNAS", "ARCX", "BATS", "XASE"]);

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

export async function fetchFinnhubQuotes(
  symbols: readonly string[],
  options?: { cache?: RequestCache }
): Promise<Record<string, FinnhubQuote>> {
  const token = getFinnhubKey();
  if (!token || symbols.length === 0) return {};

  const fetchCache = options?.cache ?? "default";
  const unique = [...new Set(symbols.map((s) => s.toUpperCase()))];
  const quotes: Record<string, FinnhubQuote> = {};

  const batchSize = 8;

  for (let i = 0; i < unique.length; i += batchSize) {
    const batch = unique.slice(i, i + batchSize);

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

          quotes[symbol] = {
            price,
            prevClose,
            changePercent: calcChangePercent(price, prevClose),
          };
          break;
        } catch (err) {
          console.error(`Finnhub quote error for ${symbol}:`, err);
          await sleep(200);
        }
      }
    }

    if (i + batchSize < unique.length) {
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
