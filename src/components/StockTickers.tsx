const TICKERS = [
  { symbol: "NVDA", change: "+4.2%", up: true },
  { symbol: "BTC", change: "+2.1%", up: true },
  { symbol: "TSLA", change: "-1.8%", up: false },
  { symbol: "AAPL", change: "+0.9%", up: true },
  { symbol: "ETH", change: "+3.4%", up: true },
  { symbol: "SPCX", change: "+16.0%", up: true },
  { symbol: "FAC", change: "-17.1%", up: false },
  { symbol: "SOL", change: "+5.2%", up: true },
  { symbol: "MSFT", change: "+1.1%", up: true },
  { symbol: "DOGE", change: "+8.3%", up: true },
  { symbol: "PLTR", change: "+6.1%", up: true },
  { symbol: "AMD", change: "-2.4%", up: false },
];

function TickerColumn({ direction }: { direction: "up" | "down" }) {
  const items = [...TICKERS, ...TICKERS];

  return (
    <div className={`stock-ticker stock-ticker--${direction}`} aria-hidden="true">
      <div className={`stock-ticker-track stock-ticker-track--${direction}`}>
        {items.map((ticker, index) => (
          <div key={`${ticker.symbol}-${index}`} className="stock-ticker-item">
            <span className="stock-ticker-symbol">{ticker.symbol}</span>
            <span
              className={
                ticker.up
                  ? "stock-ticker-change stock-ticker-change--up"
                  : "stock-ticker-change stock-ticker-change--down"
              }
            >
              {ticker.change}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function StockTickers() {
  return (
    <div className="stock-tickers-layer" aria-hidden="true">
      <TickerColumn direction="up" />
      <TickerColumn direction="down" />
    </div>
  );
}
