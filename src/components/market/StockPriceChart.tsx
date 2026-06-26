"use client";

type StockPriceChartProps = {
  timestamps: number[];
  closes: number[];
  className?: string;
};

export function StockPriceChart({
  timestamps,
  closes,
  className = "",
}: StockPriceChartProps) {
  if (closes.length < 2) {
    return (
      <p className={`text-sm text-muted ${className}`.trim()}>
        Not enough price history to chart.
      </p>
    );
  }

  const width = 320;
  const height = 140;
  const padding = { top: 8, right: 8, bottom: 24, left: 8 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;

  const points = closes
    .map((close, index) => {
      const x =
        padding.left + (index / Math.max(closes.length - 1, 1)) * plotWidth;
      const y =
        padding.top + plotHeight - ((close - min) / range) * plotHeight;
      return `${x},${y}`;
    })
    .join(" ");

  const firstDate = new Date(timestamps[0] * 1000);
  const lastDate = new Date(timestamps[timestamps.length - 1] * 1000);
  const trendUp = closes[closes.length - 1] >= closes[0];
  const stroke = trendUp ? "#4ade80" : "#f87171";

  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="stock-price-chart"
        role="img"
        aria-label="90-day price chart"
      >
        <polyline
          fill="none"
          stroke={stroke}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={points}
        />
      </svg>
      <div className="stock-price-chart-labels">
        <span>{formatShortDate(firstDate)}</span>
        <span>{formatShortDate(lastDate)}</span>
      </div>
    </div>
  );
}

function formatShortDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
