import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import {
  allSdflIdentitiesComplete,
  formatSdflSlotLabel,
  getClaimedSdflSlots,
  getOpenSdflSlots,
  getSdflIdentityFillStatus,
  isSdflLeague,
  isIdentityRowComplete,
  sdflIdentityPath,
  slotsEqual,
  type FranchiseColors,
  type SdflConference,
  type SdflDivision,
  type SdflDivisionSlot,
  validateFranchiseCity,
  validateFranchiseColors,
  validateFranchiseTeamName,
} from "@/lib/league/sdfl-divisions";

export type MemberIdentityState = {
  conference: SdflConference | null;
  division: SdflDivision | null;
  divisionSlot: number | null;
  franchiseCity: string | null;
  teamName: string | null;
  franchiseColors: FranchiseColors | null;
  franchiseLogoUrl: string | null;
  identityCompletedAt: string | null;
  slotLabel: string | null;
  complete: boolean;
};

export type LeagueIdentityPayload = {
  leagueId: string;
  leagueName: string;
  sportsLeagueId: string;
  status: string;
  playerCount: number;
  memberCount: number;
  identityFill: { complete: number; target: number };
  openSlots: SdflDivisionSlot[];
  claimedSlots: Awaited<ReturnType<typeof getClaimedSdflSlots>>;
  myIdentity: MemberIdentityState | null;
};

function parseMemberIdentity(row: {
  conference: string | null;
  division: string | null;
  division_slot: number | null;
  franchise_city: string | null;
  display_name: string | null;
  franchise_colors: unknown;
  franchise_logo_url: string | null;
  identity_completed_at: string | null;
}): MemberIdentityState {
  const slot: SdflDivisionSlot | null =
    row.conference && row.division && row.division_slot
      ? {
          conference: row.conference as SdflConference,
          division: row.division as SdflDivision,
          divisionSlot: row.division_slot,
        }
      : null;

  const colorsParsed = row.franchise_colors
    ? validateFranchiseColors(row.franchise_colors)
    : null;
  const franchiseColors =
    colorsParsed && typeof colorsParsed !== "string" ? colorsParsed : null;

  return {
    conference: slot?.conference ?? null,
    division: slot?.division ?? null,
    divisionSlot: slot?.divisionSlot ?? null,
    franchiseCity: row.franchise_city,
    teamName: row.display_name,
    franchiseColors,
    franchiseLogoUrl: row.franchise_logo_url,
    identityCompletedAt: row.identity_completed_at,
    slotLabel: slot ? formatSdflSlotLabel(slot) : null,
    complete: isIdentityRowComplete(row),
  };
}

async function assertLeagueMember(
  supabase: SupabaseClient,
  leagueId: string,
  userId: string
): Promise<{ error?: string }> {
  const { data } = await supabase
    .from("league_members")
    .select("user_id")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) return { error: "You are not a member of this league." };
  return {};
}

export async function loadLeagueIdentityPayload(
  userId: string,
  leagueId: string,
  supabaseOverride?: SupabaseClient
): Promise<{ payload?: LeagueIdentityPayload; error?: string; status?: number }> {
  const supabase = supabaseOverride ?? (await createClient());

  const membership = await assertLeagueMember(supabase, leagueId, userId);
  if (membership.error) {
    return { error: membership.error, status: 403 };
  }

  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .select("id, name, status, player_count, sports_league_id, league_type")
    .eq("id", leagueId)
    .maybeSingle();

  if (leagueError || !league) {
    return { error: leagueError?.message ?? "League not found.", status: 404 };
  }

  if (!isSdflLeague(league.sports_league_id)) {
    return { error: "This league does not use SDFL franchise identity.", status: 400 };
  }

  const { count: memberCount } = await supabase
    .from("league_members")
    .select("*", { count: "exact", head: true })
    .eq("league_id", leagueId);

  const playerCount = league.player_count ?? 32;
  const identityFill = await getSdflIdentityFillStatus(
    supabase,
    leagueId,
    playerCount
  );
  const openSlots = await getOpenSdflSlots(supabase, leagueId);
  const claimedSlots = await getClaimedSdflSlots(supabase, leagueId);

  const { data: myRow } = await supabase
    .from("league_members")
    .select(
      "conference, division, division_slot, franchise_city, display_name, franchise_colors, franchise_logo_url, identity_completed_at"
    )
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .maybeSingle();

  return {
    payload: {
      leagueId,
      leagueName: league.name,
      sportsLeagueId: league.sports_league_id ?? "sdfl",
      status: league.status,
      playerCount,
      memberCount: memberCount ?? 0,
      identityFill,
      openSlots,
      claimedSlots,
      myIdentity: myRow ? parseMemberIdentity(myRow) : null,
    },
  };
}

export async function claimSdflDivisionSlot(
  userId: string,
  leagueId: string,
  slot: SdflDivisionSlot
): Promise<{ identity?: MemberIdentityState; error?: string; status?: number }> {
  const supabase = await createClient();
  const loadResult = await loadLeagueIdentityPayload(userId, leagueId, supabase);
  if (loadResult.error || !loadResult.payload) {
    return { error: loadResult.error, status: loadResult.status };
  }

  if (loadResult.payload.status !== "waiting") {
    return { error: "Franchise slots lock once the draft has started.", status: 400 };
  }

  const { data: existing } = await supabase
    .from("league_members")
    .select(
      "conference, division, division_slot, franchise_city, display_name, franchise_colors, franchise_logo_url, identity_completed_at"
    )
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!existing) {
    return { error: "Membership not found.", status: 404 };
  }

  if (existing.conference && existing.division && existing.division_slot) {
    const currentSlot: SdflDivisionSlot = {
      conference: existing.conference as SdflConference,
      division: existing.division as SdflDivision,
      divisionSlot: existing.division_slot,
    };
    if (!slotsEqual(currentSlot, slot)) {
      return {
        error: "You already claimed a division slot for this league.",
        status: 400,
      };
    }
    return { identity: parseMemberIdentity(existing) };
  }

  const openSlots = await getOpenSdflSlots(supabase, leagueId);
  if (!openSlots.some((open) => slotsEqual(open, slot))) {
    return { error: "That division slot is no longer available.", status: 409 };
  }

  const { data: updated, error } = await supabase
    .from("league_members")
    .update({
      conference: slot.conference,
      division: slot.division,
      division_slot: slot.divisionSlot,
    })
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .select(
      "conference, division, division_slot, franchise_city, display_name, franchise_colors, franchise_logo_url, identity_completed_at"
    )
    .single();

  if (error) {
    if (error.code === "23505") {
      return { error: "That division slot was just claimed.", status: 409 };
    }
    return { error: error.message, status: 400 };
  }

  return { identity: parseMemberIdentity(updated) };
}

export async function submitSdflFranchiseIdentity(
  userId: string,
  leagueId: string,
  input: {
    franchiseCity: string;
    teamName: string;
    franchiseColors: unknown;
  }
): Promise<{ identity?: MemberIdentityState; error?: string; status?: number }> {
  const supabase = await createClient();
  const loadResult = await loadLeagueIdentityPayload(userId, leagueId, supabase);
  if (loadResult.error || !loadResult.payload) {
    return { error: loadResult.error, status: loadResult.status };
  }

  if (loadResult.payload.status !== "waiting") {
    return { error: "Identity is locked once the draft has started.", status: 400 };
  }

  const { data: existing } = await supabase
    .from("league_members")
    .select(
      "conference, division, division_slot, franchise_city, display_name, franchise_colors, franchise_logo_url, identity_completed_at"
    )
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!existing?.conference || !existing.division || !existing.division_slot) {
    return { error: "Claim a conference and division slot first.", status: 400 };
  }

  const cityError = validateFranchiseCity(input.franchiseCity);
  if (cityError) return { error: cityError, status: 400 };

  const teamError = validateFranchiseTeamName(input.teamName);
  if (teamError) return { error: teamError, status: 400 };

  const colors = validateFranchiseColors(input.franchiseColors);
  if (typeof colors === "string") return { error: colors, status: 400 };

  const now = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from("league_members")
    .update({
      franchise_city: input.franchiseCity.trim(),
      display_name: input.teamName.trim(),
      franchise_colors: colors,
      identity_completed_at: now,
    })
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .select(
      "conference, division, division_slot, franchise_city, display_name, franchise_colors, franchise_logo_url, identity_completed_at"
    )
    .single();

  if (error) return { error: error.message, status: 400 };
  return { identity: parseMemberIdentity(updated) };
}

export async function memberNeedsSdflIdentity(
  userId: string,
  leagueId: string,
  supabaseOverride?: SupabaseClient
): Promise<boolean> {
  const supabase = supabaseOverride ?? (await createClient());

  const { data: league } = await supabase
    .from("leagues")
    .select("sports_league_id")
    .eq("id", leagueId)
    .maybeSingle();

  if (!isSdflLeague(league?.sports_league_id)) return false;

  const { data: member } = await supabase
    .from("league_members")
    .select(
      "conference, division, division_slot, franchise_city, display_name, franchise_colors, identity_completed_at"
    )
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!member) return false;
  return !isIdentityRowComplete(member);
}

export {
  allSdflIdentitiesComplete,
  getSdflIdentityFillStatus,
  isSdflLeague,
  sdflIdentityPath,
};
