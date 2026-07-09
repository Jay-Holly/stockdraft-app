import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { SPORTS_SIM_BOT_PROVISION_LEAD_MS } from "@/lib/draft/draft-constants";
import { shouldFillEmptySlotsWithBots } from "@/lib/league/bot-fill";
import type { LeagueOpponentType, LeagueVisibility } from "@/lib/league/league-config";

export type ScheduledDraftRoomStatus = {
  rosterFill: { current: number; target: number } | null;
  lastError: string | null;
  botFillExpected: boolean;
  pastDue: boolean;
};

export async function getScheduledDraftRoomStatus(
  supabase: SupabaseClient,
  leagueId: string
): Promise<ScheduledDraftRoomStatus | null> {
  const { data: league, error } = await supabase
    .from("leagues")
    .select(
      "status, player_count, visibility, opponent_type, scheduled_draft_at, scheduled_draft_last_error"
    )
    .eq("id", leagueId)
    .maybeSingle();

  if (error) {
    if (
      error.code === "PGRST204" ||
      error.message?.includes("scheduled_draft_last_error")
    ) {
      const fallback = await supabase
        .from("leagues")
        .select(
          "status, player_count, visibility, opponent_type, scheduled_draft_at"
        )
        .eq("id", leagueId)
        .maybeSingle();
      if (!fallback.data || fallback.data.status !== "waiting") return null;
      return buildStatusFromLeague(fallback.data, supabase, leagueId, null);
    }
    return null;
  }

  if (!league || league.status !== "waiting") {
    return null;
  }

  return buildStatusFromLeague(league, supabase, leagueId, league.scheduled_draft_last_error ?? null);
}

async function buildStatusFromLeague(
  league: {
    status: string;
    player_count: number | null;
    visibility: string;
    opponent_type: string;
    scheduled_draft_at: string | null;
  },
  supabase: SupabaseClient,
  leagueId: string,
  lastError: string | null
): Promise<ScheduledDraftRoomStatus> {

  const scheduledAt = league.scheduled_draft_at
    ? new Date(league.scheduled_draft_at)
    : null;
  const pastDue = Boolean(scheduledAt && scheduledAt.getTime() <= Date.now());
  const provisionWindowOpen = Boolean(
    scheduledAt &&
      scheduledAt.getTime() - SPORTS_SIM_BOT_PROVISION_LEAD_MS <= Date.now()
  );
  const botFillExpected = shouldFillEmptySlotsWithBots({
    visibility: league.visibility as LeagueVisibility,
    opponentType: league.opponent_type as LeagueOpponentType,
  });

  const target = league.player_count ?? 0;
  let current = 0;

  if ((provisionWindowOpen || pastDue) && botFillExpected && target > 0) {
    const { count } = await supabase
      .from("league_members")
      .select("*", { count: "exact", head: true })
      .eq("league_id", leagueId);
    current = count ?? 0;
  }

  const rosterFill =
    (provisionWindowOpen || pastDue) &&
    botFillExpected &&
    target > 0 &&
    current < target
      ? { current, target }
      : null;

  return {
    rosterFill,
    lastError,
    botFillExpected,
    pastDue,
  };
}

export async function recordScheduledDraftAttempt(
  supabase: SupabaseClient,
  leagueId: string,
  error: string | null
): Promise<void> {
  const { error: updateError } = await supabase
    .from("leagues")
    .update({
      scheduled_draft_last_error: error,
      scheduled_draft_last_attempt_at: new Date().toISOString(),
    })
    .eq("id", leagueId);

  if (
    updateError &&
    (updateError.code === "PGRST204" ||
      updateError.message?.includes("scheduled_draft_last_error"))
  ) {
    return;
  }

  if (updateError) {
    console.error(
      `[recordScheduledDraftAttempt] league=${leagueId}:`,
      updateError.message
    );
  }
}

export async function clearScheduledDraftError(
  supabase: SupabaseClient,
  leagueId: string
): Promise<void> {
  const { error } = await supabase
    .from("leagues")
    .update({
      scheduled_draft_last_error: null,
      scheduled_draft_last_attempt_at: null,
    })
    .eq("id", leagueId);

  if (
    error &&
    (error.code === "PGRST204" ||
      error.message?.includes("scheduled_draft_last_error"))
  ) {
    return;
  }

  if (error) {
    console.error(
      `[clearScheduledDraftError] league=${leagueId}:`,
      error.message
    );
  }
}
