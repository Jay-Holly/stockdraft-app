const MARKET_TIMEZONE = "America/New_York";

function getNyParts(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: MARKET_TIMEZONE,
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    weekday: get("weekday"),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

/** US equities session: Mon–Fri 9:30 AM – 4:00 PM Eastern. */
export function isUsMarketOpen(date = new Date()): boolean {
  const { weekday, hour, minute } = getNyParts(date);

  if (weekday === "Sat" || weekday === "Sun") {
    return false;
  }

  const minutes = hour * 60 + minute;
  const open = 9 * 60 + 30;
  const close = 16 * 60;

  return minutes >= open && minutes < close;
}

/** Includes a short post-close window for EOD price capture (beta_daily 4:05 PM finalize). */
export function isUsMarketRefreshAllowed(date = new Date()): boolean {
  if (isUsMarketOpen(date)) return true;

  const { weekday, hour, minute } = getNyParts(date);
  if (weekday === "Sat" || weekday === "Sun") return false;

  const minutes = hour * 60 + minute;
  const close = 16 * 60;
  const postCloseCutoff = 16 * 60 + 30;
  return minutes >= close && minutes < postCloseCutoff;
}

export function getMarketSession(date = new Date()): "live" | "static" {
  return isUsMarketOpen(date) ? "live" : "static";
}
