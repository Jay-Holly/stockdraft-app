import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { SDBA_MAP_MARKERS } from "@/lib/league/sdba-team-map-coords";
import { SDHL_MAP_MARKERS } from "@/lib/league/sdhl-team-map-coords";
import { SDLB_MAP_MARKERS } from "@/lib/league/sdlb-team-map-coords";
import {
  validateFranchiseCity,
  validateFranchiseColors,
  validateFranchiseTeamName,
  type FranchiseColors,
} from "@/lib/league/generic-franchise-validation";
import {
  genericMapSportForLeague,
  isGenericMapLeague,
  type GenericMapSport,
} from "@/lib/league/generic-map-sport";

export type { GenericMapSport };
export { genericMapSportForLeague, isGenericMapLeague };

export type GenericMapMarker = {
  key: string;
  city: string;
  color: "red" | "blue";
  x: number;
  y: number;
};

const SPORT_MARKERS: Record<GenericMapSport, GenericMapMarker[]> = {
  nba: SDBA_MAP_MARKERS,
  nhl: SDHL_MAP_MARKERS,
  mlb: SDLB_MAP_MARKERS,
};

export function markersForSport(sport: GenericMapSport): GenericMapMarker[] {
  return SPORT_MARKERS[sport];
}

type ClaimRow = {
  slot_key: string;
  user_id: string;
  franchise_city: string | null;
  team_name: string | null;
  franchise_colors: unknown;
  identity_completed_at: string | null;
};

export type GenericMapClaim = {
  slotKey: string;
  userId: string;
  displayName: string | null;
  franchiseCity: string | null;
  teamName: string | null;
  franchiseColors: FranchiseColors | null;
  identityComplete: boolean;
};

export type GenericMyIdentity = {
  slotKey: string | null;
  city: string | null;
  franchiseCity: string | null;
  teamName: string | null;
  franchiseColors: FranchiseColors | null;
  complete: boolean;
};

export type GenericMapPayload = {
  leagueId: string;
  leagueName: string;
  status: string;
  sport: GenericMapSport;
  playerCount: number;
  markers: GenericMapMarker[];
  claims: GenericMapClaim[];
  mySlotKey: string | null;
  myIdentity: GenericMyIdentity | null;
};

function isRowComplete(row: ClaimRow): boolean {
  if (!row.identity_completed_at) return false;
  if (!row.franchise_city?.trim()) return false;
  if (!row.team_name?.trim()) return false;
  const colors = validateFranchiseColors(row.franchise_colors);
  return typeof colors !== "string";
}

function parseClaimRow(
  row: ClaimRow,
  displayName: string | null
): GenericMapClaim {
  const colorsParsed = row.franchise_colors
    ? validateFranchiseColors(row.franchise_colors)
    : null;
  const franchiseColors =
    colorsParsed && typeof colorsParsed !== "string" ? colorsParsed : null;

  return {
    slotKey: row.slot_key,
    userId: row.user_id,
    displayName,
    franchiseCity: row.franchise_city,
    teamName: row.team_name,
    franchiseColors,
    identityComplete: isRowComplete(row),
  };
}

export async function loadGenericMapPayload(
  userId: string,
  leagueId: string,
  supabaseOverride?: SupabaseClient
): Promise<{ payload: GenericMapPayload | null; error?: string; status?: number }> {
  const supabase = supabaseOverride ?? (await createClient());

  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .select("id, name, status, player_count, sports_league_id, league_type")
    .eq("id", leagueId)
    .maybeSingle();

  if (leagueError || !league) {
    return { payload: null, error: "League not found.", status: 404 };
  }

  const sport = genericMapSportForLeague(league.sports_league_id);
  if (!sport) {
    return { payload: null, error: "Not a generic-map league.", status: 400 };
  }

  const { data: membership } = await supabase
    .from("league_members")
    .select("user_id")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!membership) {
    return { payload: null, error: "Not a member of this league.", status: 403 };
  }

  const { data: claimRows, error: claimError } = await supabase
    .from("league_map_slot_claims")
    .select(
      "slot_key, user_id, franchise_city, team_name, franchise_colors, identity_completed_at"
    )
    .eq("league_id", leagueId);

  if (claimError) {
    return { payload: null, error: claimError.message, status: 500 };
  }

  const userIds = (claimRows ?? []).map((row) => row.user_id);
  const { data: memberRows } = userIds.length
    ? await supabase
        .from("league_members")
        .select("user_id, display_name")
        .eq("league_id", leagueId)
        .in("user_id", userIds)
    : { data: [] };

  const displayNameByUserId = new Map(
    (memberRows ?? []).map((row) => [row.user_id, row.display_name as string | null])
  );

  const claims: GenericMapClaim[] = (claimRows ?? []).map((row) =>
    parseClaimRow(row as ClaimRow, displayNameByUserId.get(row.user_id) ?? null)
  );

  const myClaim = claims.find((claim) => claim.userId === userId) ?? null;
  const myMarker = myClaim
    ? markersForSport(sport).find((m) => m.key === myClaim.slotKey) ?? null
    : null;

  return {
    payload: {
      leagueId,
      leagueName: league.name,
      status: league.status,
      sport,
      playerCount: league.player_count ?? markersForSport(sport).length,
      markers: markersForSport(sport),
      claims,
      mySlotKey: myClaim?.slotKey ?? null,
      myIdentity: myClaim
        ? {
            slotKey: myClaim.slotKey,
            city: myMarker?.city ?? null,
            franchiseCity: myClaim.franchiseCity,
            teamName: myClaim.teamName,
            franchiseColors: myClaim.franchiseColors,
            complete: myClaim.identityComplete,
          }
        : null,
    },
  };
}

export async function claimGenericMapSlot(
  userId: string,
  leagueId: string,
  slotKey: string
): Promise<{ ok: boolean; error?: string; status?: number }> {
  const supabase = await createClient();

  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .select("id, sports_league_id, status")
    .eq("id", leagueId)
    .maybeSingle();

  if (leagueError || !league) {
    return { ok: false, error: "League not found.", status: 404 };
  }

  if (league.status !== "waiting") {
    return { ok: false, error: "Team slots lock once the draft has started.", status: 400 };
  }

  const sport = genericMapSportForLeague(league.sports_league_id);
  if (!sport) {
    return { ok: false, error: "Not a generic-map league.", status: 400 };
  }

  const markers = markersForSport(sport);
  const marker = markers.find((m) => m.key === slotKey);
  if (!marker) {
    return { ok: false, error: "Unknown slot.", status: 400 };
  }

  const { data: membership } = await supabase
    .from("league_members")
    .select("user_id")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!membership) {
    return { ok: false, error: "Not a member of this league.", status: 403 };
  }

  const { data: existing } = await supabase
    .from("league_map_slot_claims")
    .select("slot_key")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    if (existing.slot_key === slotKey) {
      return { ok: true };
    }
    return {
      ok: false,
      error: "You already claimed a team for this league.",
      status: 400,
    };
  }

  const { error: insertError } = await supabase
    .from("league_map_slot_claims")
    .insert({
      league_id: leagueId,
      user_id: userId,
      sport,
      slot_key: slotKey,
      city_label: marker.city,
    });

  if (insertError) {
    if (insertError.code === "23505") {
      return { ok: false, error: "That team is already claimed.", status: 409 };
    }
    return { ok: false, error: insertError.message, status: 500 };
  }

  return { ok: true };
}

export async function submitGenericFranchiseIdentity(
  userId: string,
  leagueId: string,
  input: {
    franchiseCity: string;
    teamName: string;
    franchiseColors: unknown;
  }
): Promise<{ payload?: GenericMapPayload; error?: string; status?: number }> {
  const supabase = await createClient();

  const loadResult = await loadGenericMapPayload(userId, leagueId, supabase);
  if (loadResult.error || !loadResult.payload) {
    return { error: loadResult.error, status: loadResult.status };
  }

  if (loadResult.payload.status !== "waiting") {
    return { error: "Identity is locked once the draft has started.", status: 400 };
  }

  if (!loadResult.payload.mySlotKey) {
    return { error: "Claim a team on the map first.", status: 400 };
  }

  const cityError = validateFranchiseCity(input.franchiseCity);
  if (cityError) return { error: cityError, status: 400 };

  const teamError = validateFranchiseTeamName(input.teamName, loadResult.payload.sport);
  if (teamError) return { error: teamError, status: 400 };

  const colors = validateFranchiseColors(input.franchiseColors);
  if (typeof colors === "string") return { error: colors, status: 400 };

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("league_map_slot_claims")
    .update({
      franchise_city: input.franchiseCity.trim(),
      team_name: input.teamName.trim(),
      franchise_colors: colors,
      identity_completed_at: now,
    })
    .eq("league_id", leagueId)
    .eq("user_id", userId);

  if (error) return { error: error.message, status: 400 };

  // Keep league_members.display_name in sync so rosters/standings/etc. show
  // the chosen team name the same way SDFL's display_name does.
  await supabase
    .from("league_members")
    .update({ display_name: input.teamName.trim() })
    .eq("league_id", leagueId)
    .eq("user_id", userId);

  const refreshed = await loadGenericMapPayload(userId, leagueId, supabase);
  return { payload: refreshed.payload ?? undefined };
}

export async function memberNeedsGenericMapClaim(
  userId: string,
  leagueId: string,
  supabase: SupabaseClient
): Promise<boolean> {
  const { data } = await supabase
    .from("league_map_slot_claims")
    .select(
      "franchise_city, team_name, franchise_colors, identity_completed_at"
    )
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) return true;
  return !isRowComplete(data as ClaimRow);
}

const BOT_COLOR_PAIRS: FranchiseColors[] = [
  { primary: "#1d4ed8", secondary: "#f8fafc" },
  { primary: "#b91c1c", secondary: "#f1f5f9" },
  { primary: "#15803d", secondary: "#fef9c3" },
  { primary: "#7c3aed", secondary: "#fde68a" },
  { primary: "#0f766e", secondary: "#fee2e2" },
  { primary: "#c2410c", secondary: "#e0f2fe" },
];

const BOT_TEAM_NAMES = [
  "Northside Capital",
  "Summit Street",
  "Harborview FC",
  "Lakeview Holdings",
  "Metro Traders",
  "Ridgeline Equity",
  "Westport Markets",
  "Cedar Point Capital",
  "Ironwood Investors",
  "Bayfront Trading",
  "Highland Portfolio",
  "Stonebridge FC",
  "Clearwater Group",
  "Pinecrest Markets",
  "Eastgate Capital",
  "Silverline Trading",
  "Brookfield Equity",
  "Redwood Street",
  "Kingsport Markets",
  "Fairview Holdings",
  "Oakmont Traders",
  "Riverbend Capital",
  "Parkside Portfolio",
  "Granite Hill FC",
  "Seaview Markets",
  "Meadowbrook Capital",
  "Crosswind Trading",
  "Blue Ridge Equity",
  "Milltown Investors",
  "Horizon Street",
  "Beacon Hill Markets",
  "Canyon View Capital",
];

function pickBotTeamName(usedTeamNames: Set<string>, slotIndex: number): string {
  for (let offset = 0; offset < BOT_TEAM_NAMES.length; offset++) {
    const candidate = BOT_TEAM_NAMES[(slotIndex + offset) % BOT_TEAM_NAMES.length];
    if (!usedTeamNames.has(candidate.toLowerCase())) {
      usedTeamNames.add(candidate.toLowerCase());
      return candidate;
    }
  }
  const fallback = `Team ${slotIndex + 1}`;
  usedTeamNames.add(fallback.toLowerCase());
  return fallback;
}

/** Slot keys already claimed (regardless of identity completeness) for one league. */
export async function getClaimedGenericMapSlotKeys(
  supabase: SupabaseClient,
  leagueId: string
): Promise<Set<string>> {
  const { data } = await supabase
    .from("league_map_slot_claims")
    .select("slot_key")
    .eq("league_id", leagueId);
  return new Set((data ?? []).map((row) => row.slot_key as string));
}

export async function getOpenGenericMapSlots(
  supabase: SupabaseClient,
  leagueId: string,
  sport: GenericMapSport
): Promise<GenericMapMarker[]> {
  const claimedKeys = await getClaimedGenericMapSlotKeys(supabase, leagueId);
  return markersForSport(sport).filter((marker) => !claimedKeys.has(marker.key));
}

/**
 * Bot equivalent of claimGenericMapSlot + submitGenericFranchiseIdentity —
 * claims the first open map slot and completes its franchise identity in one
 * step, bypassing the "waiting" status gate those two use (bots can be
 * provisioned any time bot-fill runs, not just pre-draft). Writes directly to
 * league_map_slot_claims and syncs league_members.display_name, mirroring
 * assignBotSdflIdentity in sdfl-divisions.ts.
 */
export async function assignBotGenericMapIdentity(
  supabase: SupabaseClient,
  leagueId: string,
  userId: string,
  sport: GenericMapSport,
  slotIndex: number,
  usedTeamNames: Set<string>
): Promise<{ error?: string }> {
  const openSlots = await getOpenGenericMapSlots(supabase, leagueId, sport);
  const slot = openSlots[0];
  if (!slot) {
    return { error: `No open ${sport.toUpperCase()} map slots remain.` };
  }

  const teamName = pickBotTeamName(usedTeamNames, slotIndex);
  const colors = BOT_COLOR_PAIRS[slotIndex % BOT_COLOR_PAIRS.length];
  const now = new Date().toISOString();

  const { error } = await supabase.from("league_map_slot_claims").insert({
    league_id: leagueId,
    user_id: userId,
    sport,
    slot_key: slot.key,
    city_label: slot.city,
    franchise_city: slot.city,
    team_name: teamName,
    franchise_colors: colors,
    identity_completed_at: now,
  });

  if (error) {
    if (error.code === "23505") {
      return { error: "That map slot was just claimed." };
    }
    return { error: error.message };
  }

  const { error: memberError } = await supabase
    .from("league_members")
    .update({ display_name: teamName })
    .eq("league_id", leagueId)
    .eq("user_id", userId);

  if (memberError) return { error: memberError.message };
  return {};
}

export async function getGenericMapIdentityFillStatus(
  supabase: SupabaseClient,
  leagueId: string,
  target: number
): Promise<{ complete: number; target: number }> {
  const { data } = await supabase
    .from("league_map_slot_claims")
    .select("franchise_city, team_name, franchise_colors, identity_completed_at")
    .eq("league_id", leagueId);

  const rows = (data ?? []) as ClaimRow[];
  const complete = rows.filter((row) => isRowComplete(row)).length;
  return { complete, target };
}

export async function allGenericMapIdentitiesComplete(
  supabase: SupabaseClient,
  leagueId: string,
  sport: GenericMapSport,
  target: number
): Promise<boolean> {
  const { data, error } = await supabase
    .from("league_map_slot_claims")
    .select("franchise_city, team_name, franchise_colors, identity_completed_at")
    .eq("league_id", leagueId);

  if (error) return false;
  const rows = (data ?? []) as ClaimRow[];
  if (rows.length < target) return false;
  return rows.every((row) => isRowComplete(row));
}

/**
 * Bots can end up with a league_members row but no league_map_slot_claims
 * row if assignBotGenericMapIdentity failed mid-fill (same failure mode as
 * backfillMissingSdflBotIdentities) — retry those before gating a draft.
 */
export async function backfillMissingGenericMapBotIdentities(
  supabase: SupabaseClient,
  leagueId: string,
  sport: GenericMapSport
): Promise<{ backfilled: number; error?: string }> {
  const { data: members, error: membersError } = await supabase
    .from("league_members")
    .select("user_id, display_name, draft_slot")
    .eq("league_id", leagueId)
    .order("draft_slot", { ascending: true, nullsFirst: false });

  if (membersError) return { backfilled: 0, error: membersError.message };

  const { data: claims } = await supabase
    .from("league_map_slot_claims")
    .select("user_id")
    .eq("league_id", leagueId);
  const claimedUserIds = new Set((claims ?? []).map((row) => row.user_id as string));

  const usedTeamNames = new Set(
    (members ?? [])
      .map((member) => member.display_name?.trim().toLowerCase())
      .filter(Boolean) as string[]
  );

  let backfilled = 0;
  for (const member of members ?? []) {
    if (claimedUserIds.has(member.user_id)) continue;
    const result = await assignBotGenericMapIdentity(
      supabase,
      leagueId,
      member.user_id,
      sport,
      member.draft_slot ?? backfilled,
      usedTeamNames
    );
    if (result.error) return { backfilled, error: result.error };
    backfilled++;
  }

  return { backfilled };
}
