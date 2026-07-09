import {
  loadDraftStateDetailed,
  processAllPushbackSkips,
} from "@/lib/draft/server";
import type { DraftState } from "@/lib/draft/types";
import {
  buildLiveDraftView,
  describeLiveDraftClock,
  ensureLiveDraftProgress,
  getDraftFeed,
  isLiveDraftLeague,
} from "@/lib/draft/live-draft";
import { getDraftChatMessages } from "@/lib/draft/chat";
import { getAiLeagueBotDraftBoards } from "@/lib/league/ai-league";
import type { BotDraftBoard } from "@/lib/league/ai-league";
import { getHumanLeagueOpponentBoards, getHumanLeagueMembers } from "@/lib/league/human-league";
import { getScheduledDraftRoomStatus } from "@/lib/league/scheduled-draft-status";
import { resolveActiveLeagueId } from "@/lib/league/active-league";
import { createClient } from "@/lib/supabase/server";

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
  try {
    const resolvedLeagueId =
      options?.leagueId ?? (await resolveActiveLeagueId(userId)) ?? undefined;

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

    const supabase = await createClient();
    const { data: leagueMeta } = await supabase
      .from("leagues")
      .select("league_type, status, scheduled_draft_at, draft_format, support_code")
      .eq("id", leagueId)
      .maybeSingle();

    if (live && leagueMeta?.status === "waiting") {
      const { data: liveState } = await supabase
        .from("league_draft_state")
        .select("status, global_pick_number")
        .eq("league_id", leagueId)
        .maybeSingle();

      if (
        liveState?.status === "in_progress" &&
        (liveState.global_pick_number ?? 0) > 0
      ) {
        await supabase
          .from("leagues")
          .update({ status: "drafting" })
          .eq("id", leagueId)
          .eq("status", "waiting");
        leagueMeta.status = "drafting";
      }
    }

    const opponentBoardsPromise =
      leagueMeta?.league_type === "human"
        ? getHumanLeagueOpponentBoards(userId, leagueId).then((boards) =>
            (boards ?? []).map(
              (board): BotDraftBoard => ({
                id: board.id,
                name: board.name,
                personality: "human",
                avatarColor: "cyan",
                picks: board.picks,
                summary: board.summary,
                currentRound: board.currentRound,
                draftComplete: board.draftComplete,
              })
            )
          )
        : getAiLeagueBotDraftBoards(userId, leagueId);

    const [liveDraftRaw, draftFeed, draftChat, botDraftBoards, waitingRoomMembers, scheduledDraftStatus] =
      await Promise.all([
      live
        ? buildLiveDraftView(leagueId, userId).catch((err) => {
            console.error("buildLiveDraftView failed:", err);
            return null;
          })
        : Promise.resolve(null),
      live ? getDraftFeed(leagueId) : Promise.resolve([]),
      live ? getDraftChatMessages(leagueId) : Promise.resolve([]),
      opponentBoardsPromise.catch((err) => {
        console.error("opponent draft boards failed:", err);
        return null;
      }),
      live && leagueMeta?.status === "waiting"
        ? getHumanLeagueMembers(leagueId).then((members) =>
            members.map((member) => ({
              userId: member.userId,
              teamName: member.displayName,
            }))
          )
        : Promise.resolve(undefined),
      live && leagueMeta?.status === "waiting"
        ? getScheduledDraftRoomStatus(supabase, leagueId)
        : Promise.resolve(null),
    ]);

    let liveDraft = liveDraftRaw;
    if (live && !liveDraft) {
      const clock = await describeLiveDraftClock(leagueId);
      if (clock?.onClockUserId && clock.currentPickIndex < clock.totalPickSlots) {
        liveDraft = {
          status: "in_progress",
          onClockUserId: clock.onClockUserId,
          onClockTeamName: null,
          pickDeadlineAt: clock.pickDeadlineAt,
          isMyTurn: clock.onClockUserId === userId,
          currentPickIndex: clock.currentPickIndex,
          totalPickSlots: clock.totalPickSlots,
          globalPickNumber: clock.globalPickNumber,
          draftOrder: [],
        };
      }
    }

    return {
      ok: true,
      payload: {
        ...result.state,
        liveDraft,
        draftFeed,
        draftChat,
        botDraftBoards: botDraftBoards ?? undefined,
        leagueStatus: leagueMeta?.status,
        leagueSupportCode:
          result.state.leagueSupportCode ?? leagueMeta?.support_code ?? undefined,
        scheduledDraftAt: leagueMeta?.scheduled_draft_at ?? null,
        isLiveFormat: live,
        waitingRoomMembers,
        scheduledDraftError: scheduledDraftStatus?.lastError ?? null,
        scheduledDraftRosterFill: scheduledDraftStatus?.rosterFill ?? null,
        scheduledDraftIdentityFill: scheduledDraftStatus?.identityFill ?? null,
      },
    };
  } catch (error) {
    console.error("loadDraftApiPayload failed:", error);
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Unexpected error loading draft.",
    };
  }
}
