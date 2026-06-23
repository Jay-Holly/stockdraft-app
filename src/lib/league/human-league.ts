import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { loadDraftStateDetailed } from "@/lib/draft/server";
import { summarizePicks } from "@/lib/draft/engine";
import type { DraftPick, DraftSummary } from "@/lib/draft/types";
import type { League } from "@/lib/league/server";
import { getLeagueMemberTeamName } from "@/lib/league/server";
import { HUMAN_LEAGUE_FIELDS } from "@/lib/league/fields";
import { captureWeekBaselinesForLeague } from "@/lib/roster/weekly";
import type { CreateLeagueConfig } from "@/lib/league/league-config";
import { isHumanLeagueSupported } from "@/lib/league/league-config";
import { parseDraftOrderMethodSetting } from "@/lib/league/draft-order";
import { shouldFillEmptySlotsWithBots } from "@/lib/league/bot-fill";
import { maybeStartHumanLeagueDraft } from "@/lib/league/draft-scheduler";
import { resolveAppBaseUrl } from "@/lib/app-url";
import {
  DEFAULT_LEAGUE_SCORING_MODE,
  parseLeagueScoringMode,
} from "@/lib/league/scoring-mode";

export type HumanLeague = League & {
  league_type: "human";
  status: "waiting" | "drafting" | "active" | "complete";
  owner_user_id: string;
  format_type: "standard" | "sports_league";
  player_count: number;
  visibility: "private" | "public";
  opponent_type: "all_ai" | "all_human" | "mixed";
  invite_token: string | null;
  invite_email: string | null;
  scoring_mode: "percent_gain" | "dollar_gain";
  scheduled_draft_at: string | null;
  sports_league_id: string | null;
  pick_time_seconds: number;
  draft_order_method: string;
  sports_standings_season: number | null;
};

export type HumanLeagueInvitePreview = {
  leagueId: string;
  leagueName: string;
  commissionerTeam: string;
  memberCount: number;
  playerCount: number;
  status: string;
  opponentType: string;
  formatType: string;
};

export type PendingHumanLeagueInvite = {
  leagueId: string;
  leagueName: string;
  inviteToken: string;
  commissionerTeam: string;
};

export type HumanLeagueListItem = {
  league: HumanLeague;
  humanTeamName: string;
  memberCount: number;
  humanDraftComplete: boolean;
  inviteLink: string | null;
};

export type OpponentDraftBoard = {
  id: string;
  name: string;
  picks: DraftPick[];
  summary: DraftSummary;
  currentRound: number;
  draftComplete: boolean;
};

export async function getHumanLeagueMembers(
  leagueId: string
): Promise<Array<{ userId: string; displayName: string; draftSlot: number | null }>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("league_members")
    .select("user_id, display_name, draft_slot")
    .eq("league_id", leagueId)
    .order("draft_slot", { ascending: true, nullsFirst: false });

  return (data ?? []).map((row) => ({
    userId: row.user_id,
    displayName: row.display_name ?? "Team",
    draftSlot: row.draft_slot,
  }));
}

export async function getLeagueInvitePreview(
  token: string
): Promise<HumanLeagueInvitePreview | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_league_invite_preview", {
    p_token: token,
  });

  if (error || !data || (Array.isArray(data) && data.length === 0)) {
    return null;
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    leagueId: row.league_id,
    leagueName: row.league_name,
    commissionerTeam: row.commissioner_team,
    memberCount: Number(row.member_count),
    playerCount: row.player_count,
    status: row.status,
    opponentType: row.opponent_type,
    formatType: row.format_type,
  };
}

export async function listPendingHumanLeagueInvites(): Promise<
  PendingHumanLeagueInvite[]
> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_pending_human_league_invites");

  if (error || !data?.length) {
    return [];
  }

  return data.map(
    (row: {
      league_id: string;
      league_name: string;
      invite_token: string;
      commissioner_team: string;
    }) => ({
      leagueId: row.league_id,
      leagueName: row.league_name,
      inviteToken: String(row.invite_token),
      commissionerTeam: row.commissioner_team,
    })
  );
}

function buildInviteLink(token: string): string {
  return `${resolveAppBaseUrl()}/leagues/join/${token}`;
}

export async function createHumanLeague(
  userId: string,
  config: CreateLeagueConfig
): Promise<{ league?: HumanLeague; inviteLink?: string | null; error?: string }> {
  if (!isHumanLeagueSupported(config)) {
    return { error: "This league configuration is not supported yet." };
  }

  const leagueName = config.leagueName.trim();
  const teamName = config.teamName.trim();
  const inviteEmail = config.inviteEmail?.trim().toLowerCase() ?? "";
  const scheduledDraftAt = config.scheduledDraftAt?.trim() || null;

  if (!leagueName) return { error: "League name is required." };
  if (leagueName.length > 60) {
    return { error: "League name must be 60 characters or fewer." };
  }
  if (!teamName) return { error: "Team name is required." };
  if (teamName.length > 40) {
    return { error: "Team name must be 40 characters or fewer." };
  }

  if (
    config.visibility === "private" &&
    config.opponentType === "all_human" &&
    (!inviteEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail))
  ) {
    return { error: "A valid invite email is required." };
  }

  if (scheduledDraftAt) {
    const scheduled = new Date(scheduledDraftAt);
    if (Number.isNaN(scheduled.getTime())) {
      return { error: "Scheduled draft time is invalid." };
    }
    if (scheduled.getTime() <= Date.now()) {
      return { error: "Scheduled draft must be in the future." };
    }
  }

  const supabase = await createClient();
  const inviteToken =
    config.visibility === "public" ? null : randomUUID();

  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .insert({
      name: leagueName,
      is_solo: false,
      league_type: "human",
      status: "waiting",
      owner_user_id: userId,
      format_type: config.formatType,
      sports_league_id:
        config.formatType === "sports_league" ? config.sportsLeagueId ?? null : null,
      player_count: config.playerCount,
      visibility: config.visibility,
      opponent_type: config.opponentType,
      invite_token: inviteToken,
      invite_email: inviteEmail || null,
      scheduled_draft_at: scheduledDraftAt,
      draft_order_method:
        config.formatType === "standard"
          ? parseDraftOrderMethodSetting(config.draftOrderMethod)
          : "random_shuffle",
      scoring_mode: parseLeagueScoringMode(
        config.scoringMode ?? DEFAULT_LEAGUE_SCORING_MODE
      ),
      draft_format: "live",
      pick_time_seconds: 120,
    })
    .select(HUMAN_LEAGUE_FIELDS)
    .single();

  if (leagueError || !league) {
    return { error: leagueError?.message ?? "Could not create league." };
  }

  const { error: memberError } = await supabase.from("league_members").insert({
    league_id: league.id,
    user_id: userId,
    display_name: teamName,
    draft_slot: 0,
  });

  if (memberError) {
    return { error: memberError.message };
  }

  const { error: draftError } = await supabase.from("drafts").insert({
    league_id: league.id,
    user_id: userId,
  });

  if (draftError) {
    return { error: draftError.message };
  }

  return {
    league: league as HumanLeague,
    inviteLink: inviteToken ? buildInviteLink(inviteToken) : null,
  };
}

async function assertWaitingHumanLeagueCommissioner(
  userId: string,
  leagueId: string
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("leagues")
    .select("league_type, status, owner_user_id")
    .eq("id", leagueId)
    .maybeSingle();

  if (!data || data.league_type !== "human") {
    return { error: "League not found." };
  }
  if (data.owner_user_id !== userId) {
    return { error: "Only the league commissioner can manage invites." };
  }
  if (data.status !== "waiting") {
    return { error: "Invites can only be changed while waiting for players." };
  }

  return {};
}

export async function cancelHumanLeagueInvite(
  userId: string,
  leagueId: string
): Promise<{ error?: string }> {
  const guard = await assertWaitingHumanLeagueCommissioner(userId, leagueId);
  if (guard.error) return guard;

  const supabase = await createClient();
  const { error } = await supabase
    .from("leagues")
    .update({ invite_token: null })
    .eq("id", leagueId)
    .eq("league_type", "human")
    .eq("owner_user_id", userId)
    .eq("status", "waiting");

  if (error) return { error: error.message };
  return {};
}

export async function regenerateHumanLeagueInvite(
  userId: string,
  leagueId: string
): Promise<{ inviteLink?: string; error?: string }> {
  const guard = await assertWaitingHumanLeagueCommissioner(userId, leagueId);
  if (guard.error) return guard;

  const supabase = await createClient();
  const inviteToken = randomUUID();

  const { error } = await supabase
    .from("leagues")
    .update({ invite_token: inviteToken })
    .eq("id", leagueId)
    .eq("league_type", "human")
    .eq("owner_user_id", userId)
    .eq("status", "waiting");

  if (error) return { error: error.message };

  return { inviteLink: buildInviteLink(inviteToken) };
}

export async function joinHumanLeagueByToken(
  userId: string,
  token: string,
  teamName: string
): Promise<{ league?: HumanLeague; error?: string }> {
  const trimmedTeam = teamName.trim();
  if (!trimmedTeam) return { error: "Team name is required." };
  if (trimmedTeam.length > 40) {
    return { error: "Team name must be 40 characters or fewer." };
  }

  const preview = await getLeagueInvitePreview(token);
  if (!preview) return { error: "Invite link is invalid or expired." };
  if (preview.status !== "waiting") {
    return { error: "This league is no longer accepting players." };
  }
  if (preview.memberCount >= preview.playerCount) {
    return { error: "This league is already full." };
  }

  const supabase = await createClient();

  const { data: leagueRow } = await supabase
    .from("leagues")
    .select("owner_user_id")
    .eq("id", preview.leagueId)
    .maybeSingle();

  if (leagueRow?.owner_user_id === userId) {
    return { error: "You are already the commissioner of this league." };
  }

  const { data: existingMember } = await supabase
    .from("league_members")
    .select("user_id")
    .eq("league_id", preview.leagueId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existingMember) {
    return { error: "You are already in this league." };
  }

  const { error: memberError } = await supabase.from("league_members").insert({
    league_id: preview.leagueId,
    user_id: userId,
    display_name: trimmedTeam,
    draft_slot: preview.memberCount,
  });

  if (memberError) {
    return { error: memberError.message };
  }

  const { error: draftError } = await supabase.from("drafts").insert({
    league_id: preview.leagueId,
    user_id: userId,
  });

  if (draftError) {
    return { error: draftError.message };
  }

  const { data: leagueMeta } = await supabase
    .from("leagues")
    .select("visibility, opponent_type, scheduled_draft_at, player_count")
    .eq("id", preview.leagueId)
    .maybeSingle();

  const fillBots = leagueMeta
    ? shouldFillEmptySlotsWithBots({
        visibility: leagueMeta.visibility as "private" | "public",
        opponentType: leagueMeta.opponent_type as
          | "all_ai"
          | "all_human"
          | "mixed",
      })
    : false;

  const hasScheduledDraft = Boolean(leagueMeta?.scheduled_draft_at);
  const isFull =
    preview.memberCount + 1 >= (leagueMeta?.player_count ?? preview.playerCount);

  if (!fillBots && !hasScheduledDraft && isFull) {
    const startResult = await maybeStartHumanLeagueDraft(preview.leagueId);
    if (startResult.error) {
      return { error: startResult.error };
    }
  }

  const { data: league, error: statusError } = await supabase
    .from("leagues")
    .select(HUMAN_LEAGUE_FIELDS)
    .eq("id", preview.leagueId)
    .maybeSingle();

  if (statusError || !league) {
    return { error: statusError?.message ?? "Could not load league." };
  }

  return { league: league as HumanLeague };
}

export async function listHumanLeaguesForUser(
  userId: string
): Promise<HumanLeagueListItem[]> {
  const supabase = await createClient();

  const { data: memberships } = await supabase
    .from("league_members")
    .select("league_id")
    .eq("user_id", userId);

  const leagueIds = (memberships ?? []).map((m) => m.league_id);
  if (leagueIds.length === 0) return [];

  const { data: leagues } = await supabase
    .from("leagues")
    .select(HUMAN_LEAGUE_FIELDS)
    .in("id", leagueIds)
    .eq("league_type", "human")
    .order("created_at", { ascending: false });

  if (!leagues?.length) return [];

  return Promise.all(
    leagues.map(async (league) => {
      const members = await getHumanLeagueMembers(league.id);
      const humanDraft = await loadDraftStateDetailed(userId, {
        leagueId: league.id,
      });

      return {
        league: league as HumanLeague,
        humanTeamName: await getLeagueMemberTeamName(league.id, userId),
        memberCount: members.length,
        humanDraftComplete:
          humanDraft.ok && humanDraft.state.draft.status === "complete",
        inviteLink: league.invite_token
          ? buildInviteLink(league.invite_token)
          : null,
      };
    })
  );
}

export async function getHumanLeagueOpponentBoards(
  userId: string,
  leagueId: string
): Promise<OpponentDraftBoard[] | null> {
  const supabase = await createClient();
  const { data: league } = await supabase
    .from("leagues")
    .select("league_type")
    .eq("id", leagueId)
    .maybeSingle();

  if (!league || league.league_type !== "human") return null;

  const members = await getHumanLeagueMembers(leagueId);
  const opponents = members.filter((m) => m.userId !== userId);

  const boards = await Promise.all(
    opponents.map(async (opponent) => {
      const state = await loadDraftStateDetailed(opponent.userId, {
        leagueId,
      });
      if (!state.ok) {
        return {
          id: opponent.userId,
          name: opponent.displayName,
          picks: [] as DraftPick[],
          summary: summarizePicks([]),
          currentRound: 1,
          draftComplete: false,
        };
      }

      return {
        id: opponent.userId,
        name: opponent.displayName,
        picks: state.state.picks,
        summary: state.state.summary,
        currentRound: state.state.draft.current_round,
        draftComplete: state.state.draft.status === "complete",
      };
    })
  );

  return boards;
}

export async function activateHumanLeagueSchedule(
  leagueId: string
): Promise<{ error?: string }> {
  const supabase = await createClient();

  const { error: leagueError } = await supabase
    .from("leagues")
    .update({ status: "active" })
    .eq("id", leagueId);

  if (leagueError) return { error: leagueError.message };

  await captureWeekBaselinesForLeague(leagueId, 1);
  return {};
}
