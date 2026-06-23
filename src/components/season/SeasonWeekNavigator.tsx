"use client";

type SeasonWeekNavigatorProps = {
  selectedWeek: number;
  currentWeek: number;
  availableWeeks: number[];
  onWeekChange: (week: number) => void;
  disabled?: boolean;
  label?: string;
};

export function SeasonWeekNavigator({
  selectedWeek,
  currentWeek,
  availableWeeks,
  onWeekChange,
  disabled = false,
  label = "Season week",
}: SeasonWeekNavigatorProps) {
  const minWeek = availableWeeks[0] ?? 1;
  const maxWeek = availableWeeks[availableWeeks.length - 1] ?? currentWeek;
  const canGoBack = selectedWeek > minWeek && !disabled;
  const canGoForward = selectedWeek < maxWeek && !disabled;
  const isCurrentWeek = selectedWeek === currentWeek;
  const isHistorical = selectedWeek < currentWeek;

  return (
    <div className="season-week-nav">
      <div className="season-week-nav__controls">
        <button
          type="button"
          className="season-week-nav__btn"
          aria-label="Previous week"
          disabled={!canGoBack}
          onClick={() => onWeekChange(selectedWeek - 1)}
        >
          ←
        </button>

        <label className="season-week-nav__select-wrap">
          <span className="sr-only">{label}</span>
          <select
            className="season-week-nav__select"
            value={selectedWeek}
            disabled={disabled}
            onChange={(event) => onWeekChange(Number(event.target.value))}
          >
            {availableWeeks.map((week) => (
              <option key={week} value={week}>
                Week {week}
                {week === currentWeek ? " (current)" : ""}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="season-week-nav__btn"
          aria-label="Next week"
          disabled={!canGoForward}
          onClick={() => onWeekChange(selectedWeek + 1)}
        >
          →
        </button>
      </div>

      <p className="season-week-nav__meta">
        {isCurrentWeek
          ? "Current week · live prices"
          : isHistorical
            ? `Week ${selectedWeek} archive · frozen end-of-week snapshot`
            : `Viewing week ${selectedWeek}`}
      </p>
    </div>
  );
}
