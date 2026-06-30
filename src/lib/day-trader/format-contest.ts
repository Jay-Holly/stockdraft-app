export function formatDayTraderContestRange(
  weekStart: string,
  weekEnd: string
): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return `${fmt.format(new Date(weekStart))} – ${fmt.format(new Date(weekEnd))}`;
}
