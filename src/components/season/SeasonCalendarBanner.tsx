import type { SeasonCalendarState } from "@/lib/season/types";

type Props = {
  calendar: SeasonCalendarState | null | undefined;
  variant: "lineup" | "freeAgency" | "both";
};

function formatUnlockHint(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "shortGeneric",
  });
}

export function SeasonCalendarBanner({ calendar, variant }: Props) {
  if (!calendar?.rulesApply) return null;

  const showLineup =
    (variant === "lineup" || variant === "both") && calendar.lineupLocked;
  const showFa =
    (variant === "freeAgency" || variant === "both") &&
    !calendar.freeAgencyOpen;

  if (!showLineup && !showFa) return null;

  return (
    <div className="space-y-2">
      {showLineup && (
        <div
          className="season-calendar-banner season-calendar-banner--lock"
          role="status"
        >
          <p className="season-calendar-banner__title">Lineups locked</p>
          <p className="season-calendar-banner__detail">
            {calendar.lineupLockMessage ??
              "Lineups are locked until 4:00 PM ET."}{" "}
            IR swaps resume after the market close.
            {calendar.nextLineupUnlockAt && (
              <>
                {" "}
                Unlocks{" "}
                {formatUnlockHint(calendar.nextLineupUnlockAt) ?? "at 4:00 PM ET"}
                .
              </>
            )}
          </p>
        </div>
      )}

      {showFa && (
        <div
          className="season-calendar-banner season-calendar-banner--fa"
          role="status"
        >
          <p className="season-calendar-banner__title">Free agency closed</p>
          <p className="season-calendar-banner__detail">
            {calendar.freeAgencyMessage ??
              "Free agency is closed outside the weekly window."}
            {calendar.nextFaOpenAt && (
              <>
                {" "}
                Opens{" "}
                {formatUnlockHint(calendar.nextFaOpenAt) ?? "soon"}.
              </>
            )}
          </p>
        </div>
      )}

      {showLineup && variant === "lineup" && (
        <p className="text-xs text-muted px-1">
          Crypto rebalancing stays open — no lineup lock on crypto moves.
        </p>
      )}
    </div>
  );
}
