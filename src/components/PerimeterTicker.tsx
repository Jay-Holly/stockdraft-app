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
] as const;

function TickerSet({ id }: { id: string }) {
  return (
    <div className="orbit-strip-set">
      {TICKERS.map((ticker) => (
        <div key={`${id}-${ticker.symbol}`} className="orbit-strip-item">
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
  );
}

// Four strips hugging the picture's edges, each scrolling so the overall
// impression is one continuous clockwise loop: up the left side, right
// across the top, down the right side, left across the bottom.
export function PerimeterTicker() {
  return (
    <div className="ticker-orbit" aria-hidden="true">
      <div className="orbit-strip orbit-strip--left">
        <div className="orbit-strip-track orbit-strip-track--vertical-up">
          <TickerSet id="left-a1" />
          <TickerSet id="left-a2" />
          <TickerSet id="left-a3" />
          <TickerSet id="left-b1" />
          <TickerSet id="left-b2" />
          <TickerSet id="left-b3" />
        </div>
      </div>
      <div className="orbit-strip orbit-strip--right">
        <div className="orbit-strip-track orbit-strip-track--vertical-down">
          <TickerSet id="right-a1" />
          <TickerSet id="right-a2" />
          <TickerSet id="right-a3" />
          <TickerSet id="right-b1" />
          <TickerSet id="right-b2" />
          <TickerSet id="right-b3" />
        </div>
      </div>
      <div className="orbit-strip orbit-strip--top">
        <div className="orbit-strip-track orbit-strip-track--horizontal-right">
          <TickerSet id="top-a1" />
          <TickerSet id="top-a2" />
          <TickerSet id="top-b1" />
          <TickerSet id="top-b2" />
        </div>
      </div>
      <div className="orbit-strip orbit-strip--bottom">
        <div className="orbit-strip-track orbit-strip-track--horizontal-left">
          <TickerSet id="bottom-a1" />
          <TickerSet id="bottom-a2" />
          <TickerSet id="bottom-b1" />
          <TickerSet id="bottom-b2" />
        </div>
      </div>
    </div>
  );
}
