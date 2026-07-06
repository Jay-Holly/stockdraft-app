import { createClient } from "@/lib/supabase/server";
import { getLeagueDraftStateRow, normalizeDraftOrder, startLiveDraft } from "@/lib/draft/live-draft";
import {
  ensureStandingsForLeagueMembers,
  fillEmptySlotsWithBots,
  shouldFillEmptySlotsWithBots,
} from "@/lib/league/bot-fill";
import { resolveDraftOrderForLeague } from "@/lib/league/draft-order-server";
import { HUMAN_LEAGUE_FIELDS } from "@/lib/league/fields";
import { finalizeHumanLeagueAfterDraft } from "@/lib/matchup/seed-human-schedule";

export async function ensureDraftRowsForAllMembers(
  leagueId: string
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: members, error: membersError } = await supabase
    .from("league_members")
    .select("user_id")
    .eq("league_id", leagueId);

  if (membersError) return { error: membersError.message };

  for (const member of members ?? []) {
    const { data: existing } = await supabase
      .from("drafts")
      .select("id")
      .eq("league_id", leagueId)
      .eq("user_id", member.user_id)
      .maybeSingle();

    if (existing) continue;

    const { error } = await supabase.from("drafts").insert({
      league_id: leagueId,
      user_id: member.user_id,
    });

    if (error) {
      const duplicate =
        error.code === "23505" ||
        error.message.toLowerCase().includes("duplicate key");
      if (!duplicate) return { error: error.message };
    }
  }

  return {};
}

export async function maybeStartHumanLeagueDraft(
  leagueId: string,
  options?: { force?: boolean }
): Promise<{ started?: boolean; error?: string }> {
  const supabase = await createClient();

  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .select(
      "id, status, owner_user_id, player_count, visibility, opponent_type, scheduled_draft_at, pick_time_seconds"
    )
    .eq("id", leagueId)
    .eq("league_type", "human")
    .maybeSingle();

  if (leagueError || !league) {
    return { error: leagueError?.message ?? "League not found." };
  }

  if (league.status === "drafting" || league.status === "active") {
    const existingState = await getLeagueDraftStateRow(leagueId);
    if (normalizeDraftOrder(existingState?.draft_order).length >= 2) {
      return { started: true };
    }
  }

  if (league.status !== "waiting") {
    return { started: false };
  }

  const { count: memberCount } = await supabase
    .from("league_members")
    .select("*", { count: "exact", head: true })
    .eq("league_id", leagueId);

  const humans = memberCount ?? 0;
  const playerCount = league.player_count ?? 2;
  const scheduledAt = league.scheduled_draft_at
    ? new Date(league.scheduled_draft_at)
    : null;
  const now = new Date();

  if (scheduledAt && scheduledAt > now && !options?.force) {
    return { started: false };
  }

  const fillBots = shouldFillEmptySlotsWithBots({
    visibility: league.visibility as "private" | "public",
    opponentType: league.opponent_type as "all_ai" | "all_human" | "mixed",
  });

  if (fillBots && humans < playerCount) {
    const fillResult = await fillEmptySlotsWithBots(leagueId, playerCount);
    if (fillResult.error) return { error: fillResult.error };
  }

  const { count: finalCount } = await supabase
    .from("league_members")
    .select("*", { count: "exact", head: true })
    .eq("league_id", leagueId);

  if ((finalCount ?? 0) < playerCount) {
    if (scheduledAt && scheduledAt > now && !options?.force) {
      return { started: false };
    }
    // All-human leagues wait quietly until every roster spot is filled.
    if (!fillBots) {
      return { started: false };
    }
    return {
      error: `Waiting for ${playerCount - (finalCount ?? 0)} more player(s).`,
    };
  }

  const standingsResult = await ensureStandingsForLeagueMembers(leagueId);
  if (standingsResult.error) return standingsResult;

  const draftsResult = await ensureDraftRowsForAllMembers(leagueId);
  if (draftsResult.error) return draftsResult;

  const orderResult = await resolveDraftOrderForLeague(leagueId);
  if (orderResult.error) return { error: orderResult.error };

  const draftOrder = orderResult.draftOrder;
  if (draftOrder.length < 2) {
    return { error: "Not enough teams to start the draft." };
  }

  const ownerId = league.owner_user_id;
  if (!ownerId) return { error: "League commissioner not found." };

  const pickTimeSeconds = league.pick_time_seconds ?? 120;
  const startResult = await startLiveDraft(leagueId, ownerId, pickTimeSeconds, {
    draftOrder,
  });

  if (startResult.error) {
    return { error: startResult.error };
  }

  const { error: statusError } = await supabase
    .from("leagues")
    .update({ status: "drafting" })
    .eq("id", leagueId);

  if (statusError) return { error: statusError.message };

  return { started: true };
}

export async function processDueScheduledDrafts(): Promise<{
  processed: number;
  errors: string[];
}> {
  const supabase = await createClient();
  const nowIso = new Date().toISOString();

  const { data: dueLeagues } = await supabase
    .from("leagues")
    .select("id")
    .eq("league_type", "human")
    .eq("status", "waiting")
    .not("scheduled_draft_at", "is", null)
    .lte("scheduled_draft_at", nowIso);

  const errors: string[] = [];
  let processed = 0;

  for (const league of dueLeagues ?? []) {
    const { data: leagueRow } = await supabase
      .from("leagues")
      .select("player_count, visibility, opponent_type")
      .eq("id", league.id)
      .maybeSingle();

    if (leagueRow) {
      const fillBots = shouldFillEmptySlotsWithBots({
        visibility: leagueRow.visibility as "private" | "public",
        opponentType: leagueRow.opponent_type as "all_ai" | "all_human" | "mixed",
      });

      if (!fillBots) {
        const { count: memberCount } = await supabase
          .from("league_members")
          .select("*", { count: "exact", head: true })
          .eq("league_id", league.id);

        const playerCount = leagueRow.player_count ?? 2;
        if ((memberCount ?? 0) < playerCount) {
          // All-human leagues stay open for joins until every roster spot is filled,
          // even if the scheduled draft time has passed.
          continue;
        }
      }
    }

    const result = await maybeStartHumanLeagueDraft(league.id, { force: true });
    if (result.error) {
      errors.push(result.error);
      continue;
    }
    if (result.started) processed += 1;
  }

  return { processed, errors };
}

export async function activateHumanLeagueScheduleWithMatchups(
  leagueId: string,
  ownerUserId: string
): Promise<{ error?: string }> {
  return finalizeHumanLeagueAfterDraft(leagueId, ownerUserId);
}
