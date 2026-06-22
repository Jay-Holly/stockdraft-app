import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { startLiveDraft } from "@/lib/draft/live-draft";
import { loadDraftStateDetailed } from "@/lib/draft/server";
import { summarizePicks } from "@/lib/draft/engine";
import type { DraftPick, DraftSummary } from "@/lib/draft/types";
import type { League } from "@/lib/league/server";
import { getLeagueMemberTeamName } from "@/lib/league/server";
import { HUMAN_LEAGUE_FIELDS } from "@/lib/league/fields";
import { captureWeekBaselinesForLeague } from "@/lib/roster/weekly";
import type { CreateLeagueConfig } from "@/lib/league/league-config";
import { isHumanLeaguePoCSupported } from "@/lib/league/league-config";

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

function buildInviteLink(token: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
    "http://localhost:3000";
  return `${base}/leagues/join/${token}`;
}

export async function createHumanLeague(
  userId: string,
  config: CreateLeagueConfig
): Promise<{ league?: HumanLeague; inviteLink?: string; error?: string }> {
  if (!isHumanLeaguePoCSupported(config)) {
    return { error: "This league configuration is not supported yet." };
  }

  const leagueName = config.leagueName.trim();
  const teamName = config.teamName.trim();
  const inviteEmail = config.inviteEmail?.trim().toLowerCase() ?? "";

  if (!leagueName) return { error: "League name is required." };
  if (leagueName.length > 60) {
    return { error: "League name must be 60 characters or fewer." };
  }
  if (!teamName) return { error: "Team name is required." };
  if (teamName.length > 40) {
    return { error: "Team name must be 40 characters or fewer." };
  }
  if (!inviteEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail)) {
    return { error: "A valid invite email is required." };
  }

  const supabase = await createClient();
  const inviteToken = randomUUID();

  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .insert({
      name: leagueName,
      is_solo: false,
      league_type: "human",
      status: "waiting",
      owner_user_id: userId,
      format_type: config.formatType,
      player_count: config.playerCount,
      visibility: config.visibility,
      opponent_type: config.opponentType,
      invite_token: inviteToken,
      invite_email: inviteEmail,
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
    inviteLink: buildInviteLink(inviteToken),
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
    draft_slot: 1,
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

  const { data: league, error: statusError } = await supabase
    .from("leagues")
    .update({ status: "drafting" })
    .eq("id", preview.leagueId)
    .select(HUMAN_LEAGUE_FIELDS)
    .single();

  if (statusError || !league) {
    return { error: statusError?.message ?? "Could not start league." };
  }

  const ownerId = leagueRow?.owner_user_id;
  if (!ownerId) {
    return { error: "League commissioner not found." };
  }

  const startResult = await startLiveDraft(preview.leagueId, ownerId, 120, {
    draftOrder: [ownerId, userId],
  });

  if (startResult.error) {
    return {
      error: `Joined league but live draft failed to start: ${startResult.error}`,
    };
  }

  await supabase.from("league_standings").insert([
    { league_id: preview.leagueId, user_id: ownerId, wins: 0, losses: 0, current_week: 1 },
    { league_id: preview.leagueId, user_id: userId, wins: 0, losses: 0, current_week: 1 },
  ]);

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
