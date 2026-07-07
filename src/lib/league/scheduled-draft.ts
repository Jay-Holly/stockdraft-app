export const DRAFT_COUNTDOWN_WINDOW_MINUTES = 60;
export const ENTER_DRAFT_WINDOW_MINUTES = 5;
export const DRAFT_COUNTDOWN_TICK_MS = 30_000;

export function getMsUntilScheduledDraft(
  scheduledDraftAt: string | null | undefined
): number | null {
  if (!scheduledDraftAt) return null;
  return new Date(scheduledDraftAt).getTime() - Date.now();
}

export function isDraftCountdownVisible(
  scheduledDraftAt: string | null | undefined
): boolean {
  const ms = getMsUntilScheduledDraft(scheduledDraftAt);
  return (
    ms !== null &&
    ms > 0 &&
    ms <= DRAFT_COUNTDOWN_WINDOW_MINUTES * 60 * 1000
  );
}

export function canEnterScheduledDraftRoom(
  scheduledDraftAt: string | null | undefined
): boolean {
  const ms = getMsUntilScheduledDraft(scheduledDraftAt);
  return (
    ms !== null && ms > 0 && ms <= ENTER_DRAFT_WINDOW_MINUTES * 60 * 1000
  );
}

export function formatDraftBeginsIn(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

export function draftRoomHref(leagueId: string): string {
  return `/draft?league=${encodeURIComponent(leagueId)}`;
}
