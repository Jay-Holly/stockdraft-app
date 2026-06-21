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
  symbols: readonly string[]
): Promise<Record<string, FinnhubQuote>> {
  const token = getFinnhubKey();
  if (!token || symbols.length === 0) return {};

  const unique = [...new Set(symbols.map((s) => s.toUpperCase()))];
  const quotes: Record<string, FinnhubQuote> = {};

  const batchSize = 8;

  for (let i = 0; i < unique.length; i += batchSize) {
    const batch = unique.slice(i, i + batchSize);

    for (const symbol of batch) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await fetch(
            `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${token}`,
            { next: { revalidate: 60 } }
          );

          if (!response.ok) {
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
        } catch {
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

export async function searchFinnhubSymbols(
  query: string
): Promise<FinnhubSearchResult[]> {
  const token = getFinnhubKey();
  if (!token || query.trim().length < 1) return [];

  try {
    const response = await fetch(
      `https://finnhub.io/api/v1/search?q=${encodeURIComponent(query.trim())}&token=${token}`,
      { next: { revalidate: 300 } }
    );

    if (!response.ok) return [];

    const data = (await response.json()) as { result?: FinnhubSearchResult[] };
    const results = data.result ?? [];

    return results
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
  } catch {
    return [];
  }
}
