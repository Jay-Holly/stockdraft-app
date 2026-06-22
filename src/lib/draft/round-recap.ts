import type { DraftFeedEvent } from "@/lib/draft/types";
import { TOTAL_ROUNDS } from "@/lib/draft/types";

export type RoundRecapLine = {
  teamName: string;
  userId: string;
  status: "picked" | "skipped" | "pending" | "waiting";
  summary: string;
  isAutoPick: boolean;
  pickType?: string;
};

export function getCurrentDraftRound(
  currentPickIndex: number,
  teamCount: number
): number {
  if (teamCount <= 0) return 1;
  return Math.min(
    TOTAL_ROUNDS,
    Math.floor(currentPickIndex / teamCount) + 1
  );
}

export function getMaxRoundWithEvents(feed: DraftFeedEvent[]): number {
  if (feed.length === 0) return 1;
  return Math.max(...feed.map((e) => e.round_number));
}

/** Strip the leading "Round N — " prefix from a feed message. */
export function formatTeamActionFromEvent(event: DraftFeedEvent): string {
  return event.message.replace(/^Round \d+ — /, "");
}

export function buildRoundRecap(
  feed: DraftFeedEvent[],
  round: number,
  draftOrder: Array<{ userId: string; teamName: string }>,
  options?: {
    currentPickIndex?: number;
    draftComplete?: boolean;
  }
): RoundRecapLine[] {
  const teamCount = draftOrder.length;
  if (teamCount === 0) return [];

  const roundStartIndex = (round - 1) * teamCount;

  return draftOrder.map((team, slotIndex) => {
    const pickIndex = roundStartIndex + slotIndex;
    const event = feed.find(
      (e) => e.round_number === round && e.user_id === team.userId
    );

    if (event) {
      return {
        teamName: team.teamName,
        userId: team.userId,
        status: event.pick_type === "skip" ? "skipped" : "picked",
        summary: formatTeamActionFromEvent(event),
        isAutoPick: event.is_auto_pick,
        pickType: event.pick_type,
      };
    }

    const pending =
      !options?.draftComplete &&
      options?.currentPickIndex !== undefined &&
      pickIndex >= options.currentPickIndex;

    return {
      teamName: team.teamName,
      userId: team.userId,
      status: pending ? "pending" : "waiting",
      summary: pending ? "Waiting to pick…" : "Round not started yet",
      isAutoPick: false,
    };
  });
}
