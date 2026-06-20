"use client";

import { useLiveMarketData } from "@/hooks/useLiveMarketData";
import type { MarketQuote } from "@/lib/market/types";

function formatChange(changePercent: number): string {
  const sign = changePercent >= 0 ? "+" : "";
  return `${sign}${changePercent.toFixed(1)}%`;
}

function TickerItem({ quote }: { quote: MarketQuote }) {
  const isUp = quote.changePercent >= 0;

  return (
    <span className="live-ticker-item">
      <span className="live-ticker-symbol">{quote.symbol}</span>
      <span
        className={
          isUp ? "live-ticker-change live-ticker-change--up" : "live-ticker-change live-ticker-change--down"
        }
      >
        {formatChange(quote.changePercent)}
      </span>
    </span>
  );
}

export function LiveTickerTape() {
  const { quotes, session, loading, error } = useLiveMarketData();
  const loopQuotes = quotes.length > 0 ? [...quotes, ...quotes] : [];

  return (
    <section
      className="live-ticker-tape live-ticker-tape--embedded"
      aria-label="Live market ticker"
    >
      <div className="live-ticker-header">
        <span
          className={
            session === "live"
              ? "live-ticker-badge live-ticker-badge--live"
              : "live-ticker-badge live-ticker-badge--static"
          }
        >
          {session === "live" ? "LIVE" : "STATIC"}
        </span>
        <span className="live-ticker-caption">
          {session === "live"
            ? "US market session"
            : "Last known stock prices"}
        </span>
      </div>

      <div className="live-ticker-viewport">
        {loading && quotes.length === 0 ? (
          <p className="live-ticker-status">Loading market data…</p>
        ) : error && quotes.length === 0 ? (
          <p className="live-ticker-status">{error}</p>
        ) : (
          <div className="live-ticker-track">
            {loopQuotes.map((quote, index) => (
              <TickerItem key={`${quote.symbol}-${index}`} quote={quote} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
