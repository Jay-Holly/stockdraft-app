import { getYahooFinanceQuoteUrl } from "@/lib/market/yahoo-finance";

function ChartIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 3v18h18" />
      <path d="M7 16l4-6 4 3 6-8" />
    </svg>
  );
}

export function StockDetailChartButton({
  symbol,
  label,
}: {
  symbol: string;
  label?: string;
}) {
  const normalized = symbol.trim().toUpperCase();
  const href = getYahooFinanceQuoteUrl(normalized);
  const ariaLabel = label ?? `View ${normalized} on Yahoo Finance`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="stock-detail-chart-btn"
      aria-label={ariaLabel}
      title={ariaLabel}
      onClick={(e) => e.stopPropagation()}
    >
      <ChartIcon />
    </a>
  );
}
