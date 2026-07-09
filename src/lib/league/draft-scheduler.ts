import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { getLeagueDraftStateRow, normalizeDraftOrder, startLiveDraft } from "@/lib/draft/live-draft";
import {
  ensureStandingsForLeagueMembers,
  fillEmptySlotsWithBots,
  shouldFillEmptySlotsWithBots,
} from "@/lib/league/bot-fill";
import { SPORTS_SIM_BOT_PROVISION_LEAD_MS } from "@/lib/draft/draft-constants";
import { resolveDraftOrderForLeague } from "@/lib/league/draft-order-server";
import { isSdflLeague } from "@/lib/league/sdfl-divisions";
import { allSdflIdentitiesComplete } from "@/lib/league/team-identity";
import {
  clearScheduledDraftError,
  recordScheduledDraftAttempt,
} from "@/lib/league/scheduled-draft-status";
import { finalizeHumanLeagueAfterDraft } from "@/lib/matchup/seed-human-schedule";

export type ProcessDueScheduledDraftsOptions = {
  supabase?: SupabaseClient;
  /** Max synthetic bots to add per league per invocation (resume on next run). */
  maxBotsPerLeaguePerRun?: number;
};

export type MaybeStartHumanLeagueDraftOptions = {
  force?: boolean;
  supabase?: SupabaseClient;
  maxBotsPerRun?: number;
};

export async function ensureDraftRowsForAllMembers(
  leagueId: string,
  supabaseOverride?: SupabaseClient
): Promise<{ error?: string }> {
  const supabase = supabaseOverride ?? (await createClient());
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

export type MaybeStartHumanLeagueDraftResult = {
  started?: boolean;
  botFillInProgress?: boolean;
  identityFillInProgress?: boolean;
  error?: string;
};

export async function maybeStartHumanLeagueDraft(
  leagueId: string,
  options?: MaybeStartHumanLeagueDraftOptions
): Promise<MaybeStartHumanLeagueDraftResult> {
  const supabase = options?.supabase ?? (await createClient());

  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .select(
      "id, status, owner_user_id, player_count, visibility, opponent_type, scheduled_draft_at, pick_time_seconds, support_code, sports_league_id"
    )
    .eq("id", leagueId)
    .eq("league_type", "human")
    .maybeSingle();

  if (leagueError || !league) {
    return { error: leagueError?.message ?? "League not found." };
  }

  const leagueLabel = league.support_code ?? leagueId;

  if (league.status === "drafting" || league.status === "active") {
    const existingState = await getLeagueDraftStateRow(leagueId, supabase);
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
  const draftDue = Boolean(scheduledAt && scheduledAt <= now);
  const botProvisionWindowOpen = Boolean(
    scheduledAt &&
      scheduledAt.getTime() - SPORTS_SIM_BOT_PROVISION_LEAD_MS <= now.getTime()
  );

  const fillBots = shouldFillEmptySlotsWithBots({
    visibility: league.visibility as "private" | "public",
    opponentType: league.opponent_type as "all_ai" | "all_human" | "mixed",
  });

  if (fillBots && humans < playerCount) {
    if (!botProvisionWindowOpen && !draftDue && !options?.force) {
      return { started: false };
    }

    const fillResult = await fillEmptySlotsWithBots(leagueId, playerCount, {
      supabase,
      maxBotsPerRun: options?.maxBotsPerRun,
    });

    if (fillResult.error) {
      const message = `${leagueLabel}: bot fill failed after ${fillResult.filled} bot(s) — ${fillResult.error}`;
      await recordScheduledDraftAttempt(supabase, leagueId, message);
      return { error: message };
    }

    if (fillResult.remainingSlots > 0) {
      await recordScheduledDraftAttempt(supabase, leagueId, null);
      return { started: false, botFillInProgress: true };
    }

    if (!draftDue && !options?.force) {
      return { started: false };
    }
  }

  if (scheduledAt && scheduledAt > now && !options?.force) {
    return { started: false };
  }

  const { count: finalCount } = await supabase
    .from("league_members")
    .select("*", { count: "exact", head: true })
    .eq("league_id", leagueId);

  if ((finalCount ?? 0) < playerCount) {
    if (scheduledAt && scheduledAt > now && !options?.force) {
      return { started: false };
    }
    if (!fillBots) {
      return { started: false };
    }
    const message = `${leagueLabel}: waiting for ${playerCount - (finalCount ?? 0)} more player(s).`;
    await recordScheduledDraftAttempt(supabase, leagueId, message);
    return { error: message };
  }

  if (isSdflLeague(league.sports_league_id)) {
    const identitiesReady = await allSdflIdentitiesComplete(
      supabase,
      leagueId,
      playerCount
    );
    if (!identitiesReady) {
      const message = `${leagueLabel}: waiting for all franchise identities before the draft can start.`;
      await recordScheduledDraftAttempt(supabase, leagueId, message);
      return { started: false, identityFillInProgress: true };
    }
  }

  const standingsResult = await ensureStandingsForLeagueMembers(
    leagueId,
    supabase
  );
  if (standingsResult.error) {
    const message = `${leagueLabel}: ${standingsResult.error}`;
    await recordScheduledDraftAttempt(supabase, leagueId, message);
    return { error: message };
  }

  const draftsResult = await ensureDraftRowsForAllMembers(leagueId, supabase);
  if (draftsResult.error) {
    const message = `${leagueLabel}: ${draftsResult.error}`;
    await recordScheduledDraftAttempt(supabase, leagueId, message);
    return { error: message };
  }

  const orderResult = await resolveDraftOrderForLeague(leagueId, supabase);
  if (orderResult.error) {
    const message = `${leagueLabel}: ${orderResult.error}`;
    await recordScheduledDraftAttempt(supabase, leagueId, message);
    return { error: message };
  }

  const draftOrder = orderResult.draftOrder;
  if (draftOrder.length < 2) {
    const message = `${leagueLabel}: not enough teams to start the draft.`;
    await recordScheduledDraftAttempt(supabase, leagueId, message);
    return { error: message };
  }

  const ownerId = league.owner_user_id;
  if (!ownerId) {
    const message = `${leagueLabel}: league commissioner not found.`;
    await recordScheduledDraftAttempt(supabase, leagueId, message);
    return { error: message };
  }

  const pickTimeSeconds = league.pick_time_seconds ?? 120;
  const startResult = await startLiveDraft(leagueId, ownerId, pickTimeSeconds, {
    draftOrder,
    supabase,
  });

  if (startResult.error) {
    const message = `${leagueLabel}: ${startResult.error}`;
    await recordScheduledDraftAttempt(supabase, leagueId, message);
    return { error: message };
  }

  const { error: statusError } = await supabase
    .from("leagues")
    .update({ status: "drafting" })
    .eq("id", leagueId);

  if (statusError) {
    const message = `${leagueLabel}: ${statusError.message}`;
    await recordScheduledDraftAttempt(supabase, leagueId, message);
    return { error: message };
  }

  await clearScheduledDraftError(supabase, leagueId);
  return { started: true };
}

export async function processDueScheduledDrafts(
  options?: ProcessDueScheduledDraftsOptions
): Promise<{
  processed: number;
  inProgress: number;
  errors: string[];
  attemptedLeagues: number;
}> {
  const supabase = options?.supabase ?? (await createClient());
  const now = new Date();
  const nowIso = now.toISOString();
  const provisionDeadlineIso = new Date(
    now.getTime() + SPORTS_SIM_BOT_PROVISION_LEAD_MS
  ).toISOString();

  const { data: candidateLeagues } = await supabase
    .from("leagues")
    .select("id, scheduled_draft_at")
    .eq("league_type", "human")
    .eq("status", "waiting")
    .not("scheduled_draft_at", "is", null)
    .lte("scheduled_draft_at", provisionDeadlineIso);

  const errors: string[] = [];
  let processed = 0;
  let inProgress = 0;

  for (const league of candidateLeagues ?? []) {
    const scheduledAt = league.scheduled_draft_at
      ? new Date(league.scheduled_draft_at)
      : null;
    const pastDue = Boolean(scheduledAt && scheduledAt <= now);
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
          continue;
        }
      }
    }

    const result = await maybeStartHumanLeagueDraft(league.id, {
      force: pastDue,
      supabase,
      maxBotsPerRun: options?.maxBotsPerLeaguePerRun,
    });

    if (result.error) {
      errors.push(result.error);
      continue;
    }
    if (result.botFillInProgress) {
      inProgress += 1;
      continue;
    }
    if (result.identityFillInProgress) {
      inProgress += 1;
      continue;
    }
    if (result.started) processed += 1;
  }

  return {
    processed,
    inProgress,
    errors,
    attemptedLeagues: candidateLeagues?.length ?? 0,
  };
}

export async function activateHumanLeagueScheduleWithMatchups(
  leagueId: string,
  ownerUserId: string
): Promise<{ error?: string }> {
  return finalizeHumanLeagueAfterDraft(leagueId, ownerUserId);
}
