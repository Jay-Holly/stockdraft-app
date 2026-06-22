import {
  loadDraftStateDetailed,
  processAllPushbackSkips,
} from "@/lib/draft/server";
import type { DraftState } from "@/lib/draft/types";
import {
  buildLiveDraftView,
  ensureLiveDraftProgress,
  getDraftFeed,
  isLiveDraftLeague,
} from "@/lib/draft/live-draft";
import { getDraftChatMessages } from "@/lib/draft/chat";
import { getAiLeagueBotDraftBoards } from "@/lib/league/ai-league";
import type { BotDraftBoard } from "@/lib/league/ai-league";
import { resolveActiveAiLeagueId } from "@/lib/league/active-league";

export type DraftApiPayload = DraftState & {
  botDraftBoards?: BotDraftBoard[];
};

export async function loadDraftApiPayload(
  userId: string,
  options?: { leagueId?: string }
): Promise<
  | { ok: true; payload: DraftApiPayload }
  | { ok: false; error: string; partial?: DraftState }
> {
  const resolvedLeagueId =
    options?.leagueId ?? (await resolveActiveAiLeagueId(userId)) ?? undefined;

  let result = await loadDraftStateDetailed(userId, {
    leagueId: resolvedLeagueId,
  });
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  const leagueId = result.state.leagueId;
  const live = await isLiveDraftLeague(leagueId);

  if (live) {
    const progress = await ensureLiveDraftProgress(leagueId, {
      interactive: false,
    });
    if (progress.error) {
      return { ok: false, error: progress.error, partial: result.state };
    }

    result = await loadDraftStateDetailed(userId, { leagueId });
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
  } else {
    const skipResult = await processAllPushbackSkips(userId, { leagueId });
    if (skipResult.error) {
      return { ok: false, error: skipResult.error, partial: result.state };
    }

    result = await loadDraftStateDetailed(userId, { leagueId });
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
  }

  const [liveDraft, draftFeed, draftChat, botDraftBoards] = await Promise.all([
    live ? buildLiveDraftView(leagueId, userId) : Promise.resolve(null),
    live ? getDraftFeed(leagueId) : Promise.resolve([]),
    live ? getDraftChatMessages(leagueId) : Promise.resolve([]),
    getAiLeagueBotDraftBoards(userId, leagueId),
  ]);

  return {
    ok: true,
    payload: {
      ...result.state,
      liveDraft,
      draftFeed,
      draftChat,
      botDraftBoards: botDraftBoards ?? undefined,
    },
  };
}
