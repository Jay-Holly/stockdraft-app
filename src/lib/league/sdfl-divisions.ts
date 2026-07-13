import type { SupabaseClient } from "@supabase/supabase-js";

export type SdflConference = "sdal" | "sdnl";
export type SdflDivision = "north" | "south" | "east" | "west";

export type SdflDivisionSlot = {
  conference: SdflConference;
  division: SdflDivision;
  divisionSlot: number;
};

export type FranchiseColors = {
  primary: string;
  secondary: string;
};

export type ClaimedSdflSlot = SdflDivisionSlot & {
  userId: string;
  displayName: string | null;
  franchiseCity: string | null;
  identityComplete: boolean;
};

/** 32 real NFL team nicknames — blocked in franchise team names (substring, case-insensitive). */
export const NFL_BLOCKED_NICKNAMES = [
  "49ers",
  "Bears",
  "Bengals",
  "Bills",
  "Broncos",
  "Browns",
  "Buccaneers",
  "Cardinals",
  "Chargers",
  "Chiefs",
  "Colts",
  "Commanders",
  "Cowboys",
  "Dolphins",
  "Eagles",
  "Falcons",
  "Giants",
  "Jaguars",
  "Jets",
  "Lions",
  "Packers",
  "Panthers",
  "Patriots",
  "Raiders",
  "Rams",
  "Ravens",
  "Saints",
  "Seahawks",
  "Steelers",
  "Texans",
  "Titans",
  "Vikings",
] as const;

export const SDFL_CONFERENCE_LABELS: Record<SdflConference, string> = {
  sdal: "SDAL",
  sdnl: "SDNL",
};

export const SDFL_DIVISION_LABELS: Record<SdflDivision, string> = {
  north: "North",
  south: "South",
  east: "East",
  west: "West",
};

const CONFERENCES: SdflConference[] = ["sdal", "sdnl"];
const DIVISIONS: SdflDivision[] = ["north", "south", "east", "west"];

export const SDFL_DIVISION_SLOTS: SdflDivisionSlot[] = CONFERENCES.flatMap(
  (conference) =>
    DIVISIONS.flatMap((division) =>
      [1, 2, 3, 4].map(
        (divisionSlot): SdflDivisionSlot => ({
          conference,
          division,
          divisionSlot,
        })
      )
    )
);

export function isSdflLeague(sportsLeagueId: string | null | undefined): boolean {
  return sportsLeagueId?.toLowerCase() === "sdfl";
}

export function sdflIdentityPath(leagueId: string): string {
  return `/leagues/${leagueId}/identity`;
}

export function slotKey(slot: SdflDivisionSlot): string {
  return `${slot.conference}:${slot.division}:${slot.divisionSlot}`;
}

export function slotsEqual(a: SdflDivisionSlot, b: SdflDivisionSlot): boolean {
  return (
    a.conference === b.conference &&
    a.division === b.division &&
    a.divisionSlot === b.divisionSlot
  );
}

export function formatSdflSlotLabel(slot: SdflDivisionSlot): string {
  return `${SDFL_CONFERENCE_LABELS[slot.conference]} ${SDFL_DIVISION_LABELS[slot.division]} · Slot ${slot.divisionSlot}`;
}

export function validateFranchiseCity(city: string): string | null {
  const trimmed = city.trim();
  if (!trimmed) return "City is required.";
  if (trimmed.length > 60) return "City must be 60 characters or fewer.";
  return null;
}

export function validateFranchiseTeamName(teamName: string): string | null {
  const trimmed = teamName.trim();
  if (!trimmed) return "Team name is required.";
  if (trimmed.length > 40) return "Team name must be 40 characters or fewer.";

  const lower = trimmed.toLowerCase();
  for (const nickname of NFL_BLOCKED_NICKNAMES) {
    if (lower.includes(nickname.toLowerCase())) {
      return `Team name cannot include the NFL nickname "${nickname}".`;
    }
  }

  return null;
}

export function validateFranchiseColors(colors: unknown): FranchiseColors | string {
  if (!colors || typeof colors !== "object") {
    return "Color scheme is required.";
  }

  const record = colors as Record<string, unknown>;
  const primary = typeof record.primary === "string" ? record.primary.trim() : "";
  const secondary =
    typeof record.secondary === "string" ? record.secondary.trim() : "";

  const hexRe = /^#[0-9a-fA-F]{6}$/;
  if (!hexRe.test(primary)) return "Primary color must be a valid hex code.";
  if (!hexRe.test(secondary)) return "Secondary color must be a valid hex code.";
  if (primary.toLowerCase() === secondary.toLowerCase()) {
    return "Primary and secondary colors must differ.";
  }

  return { primary, secondary };
}

export function isIdentityRowComplete(row: {
  conference: string | null;
  division: string | null;
  division_slot: number | null;
  franchise_city: string | null;
  display_name: string | null;
  franchise_colors: unknown;
  identity_completed_at: string | null;
}): boolean {
  if (!row.identity_completed_at) return false;
  if (!row.conference || !row.division || !row.division_slot) return false;
  if (!row.franchise_city?.trim()) return false;
  if (!row.display_name?.trim() || row.display_name.trim() === "Pending") {
    return false;
  }

  const colors = validateFranchiseColors(row.franchise_colors);
  return typeof colors !== "string";
}

type MemberIdentityRow = {
  user_id: string;
  display_name: string | null;
  conference: string | null;
  division: string | null;
  division_slot: number | null;
  franchise_city: string | null;
  franchise_colors: unknown;
  identity_completed_at: string | null;
};

export async function loadSdflMemberIdentityRows(
  supabase: SupabaseClient,
  leagueId: string
): Promise<MemberIdentityRow[]> {
  const { data, error } = await supabase
    .from("league_members")
    .select(
      "user_id, display_name, conference, division, division_slot, franchise_city, franchise_colors, identity_completed_at"
    )
    .eq("league_id", leagueId);

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getClaimedSdflSlots(
  supabase: SupabaseClient,
  leagueId: string
): Promise<ClaimedSdflSlot[]> {
  const rows = await loadSdflMemberIdentityRows(supabase, leagueId);
  return rows
    .filter((row) => row.conference && row.division && row.division_slot)
    .map((row) => ({
      conference: row.conference as SdflConference,
      division: row.division as SdflDivision,
      divisionSlot: row.division_slot as number,
      userId: row.user_id,
      displayName: row.display_name,
      franchiseCity: row.franchise_city,
      identityComplete: isIdentityRowComplete(row),
    }));
}

export async function getOpenSdflSlots(
  supabase: SupabaseClient,
  leagueId: string
): Promise<SdflDivisionSlot[]> {
  const claimed = await getClaimedSdflSlots(supabase, leagueId);
  const claimedKeys = new Set(claimed.map((slot) => slotKey(slot)));
  return SDFL_DIVISION_SLOTS.filter((slot) => !claimedKeys.has(slotKey(slot)));
}

export async function getSdflIdentityFillStatus(
  supabase: SupabaseClient,
  leagueId: string,
  target: number
): Promise<{ complete: number; target: number }> {
  const rows = await loadSdflMemberIdentityRows(supabase, leagueId);
  const complete = rows.filter((row) => isIdentityRowComplete(row)).length;
  return { complete, target };
}

export async function allSdflIdentitiesComplete(
  supabase: SupabaseClient,
  leagueId: string,
  target: number
): Promise<boolean> {
  const rows = await loadSdflMemberIdentityRows(supabase, leagueId);
  if (rows.length < target) return false;
  return rows.every((row) => isIdentityRowComplete(row));
}

export function pickFirstOpenSdflSlot(
  openSlots: SdflDivisionSlot[]
): SdflDivisionSlot | null {
  for (const template of SDFL_DIVISION_SLOTS) {
    const match = openSlots.find((slot) => slotsEqual(slot, template));
    if (match) return match;
  }
  return null;
}

const BOT_CITIES = [
  "Ashford",
  "Bayview",
  "Cedar Falls",
  "Dunmore",
  "Eastbrook",
  "Fairmont",
  "Granite Bay",
  "Harbor Point",
  "Ironwood",
  "Kingsbridge",
  "Lakewood",
  "Milltown",
  "Northgate",
  "Oakridge",
  "Pinehurst",
  "Quail Run",
  "Ridgeline",
  "Silver Creek",
  "Thornfield",
  "Unionville",
  "Valley Forge",
  "Westhaven",
  "Yorktown",
  "Zephyr Hills",
  "Brookhaven",
  "Clearwater",
  "Deerfield",
  "Elmwood",
  "Foxborough",
  "Greenville",
  "Highland",
  "Juniper",
];

const BOT_TEAM_PREFIXES = [
  "Crimson",
  "Silver",
  "Golden",
  "Midnight",
  "Thunder",
  "Iron",
  "Royal",
  "Storm",
  "Blaze",
  "Frost",
  "Summit",
  "Ridge",
  "Harbor",
  "Canyon",
  "Frontier",
  "Horizon",
];

const BOT_TEAM_SUFFIXES = [
  "Wolves",
  "Hawks",
  "Stallions",
  "Phantoms",
  "Guardians",
  "Sentinels",
  "Marauders",
  "Voyagers",
  "Renegades",
  "Pioneers",
  "Outlaws",
  "Rangers",
  "Cougars",
  "Mustangs",
  "Warriors",
  "Knights",
];

const BOT_COLOR_PAIRS: FranchiseColors[] = [
  { primary: "#0a3d8f", secondary: "#d0ab48" },
  { primary: "#ef4444", secondary: "#f8fafc" },
  { primary: "#10b981", secondary: "#0f172a" },
  { primary: "#8b5cf6", secondary: "#f97316" },
  { primary: "#0369a1", secondary: "#94a3b8" },
  { primary: "#b45309", secondary: "#1e293b" },
  { primary: "#be123c", secondary: "#e2e8f0" },
  { primary: "#047857", secondary: "#fcd34d" },
];

function pickBotTeamName(usedLower: Set<string>, slotIndex: number): string {
  for (let offset = 0; offset < BOT_TEAM_PREFIXES.length; offset++) {
    const prefix =
      BOT_TEAM_PREFIXES[(slotIndex + offset) % BOT_TEAM_PREFIXES.length];
    for (let suffixOffset = 0; suffixOffset < BOT_TEAM_SUFFIXES.length; suffixOffset++) {
      const suffix =
        BOT_TEAM_SUFFIXES[
          (slotIndex + suffixOffset) % BOT_TEAM_SUFFIXES.length
        ];
      const candidate = `${prefix} ${suffix}`;
      if (validateFranchiseTeamName(candidate)) continue;
      const key = candidate.toLowerCase();
      if (!usedLower.has(key)) {
        usedLower.add(key);
        return candidate;
      }
    }
  }

  const fallback = `Metro FC ${slotIndex + 1}`;
  usedLower.add(fallback.toLowerCase());
  return fallback;
}

export function generateBotSdflIdentity(
  slotIndex: number,
  usedTeamNames: Set<string>
): {
  city: string;
  teamName: string;
  colors: FranchiseColors;
} {
  const city = BOT_CITIES[slotIndex % BOT_CITIES.length];
  const teamName = pickBotTeamName(usedTeamNames, slotIndex);
  const colors = BOT_COLOR_PAIRS[slotIndex % BOT_COLOR_PAIRS.length];
  return { city, teamName, colors };
}

/**
 * Bots get their league_members row created and their SDFL identity
 * assigned in the same step (see fillEmptySlotsWithBots). If the identity
 * half fails — transient error, no retry there — the row is left stuck at
 * display_name "Pending" forever, since once all 32 rows exist the fill
 * loop never runs again. This finds and retries just those stuck rows.
 */
export async function backfillMissingSdflBotIdentities(
  supabase: SupabaseClient,
  leagueId: string
): Promise<{ backfilled: number; error?: string }> {
  const rows = await loadSdflMemberIdentityRows(supabase, leagueId);

  const usedTeamNames = new Set(
    rows
      .map((row) => row.display_name?.trim().toLowerCase())
      .filter((name): name is string => Boolean(name) && name !== "pending")
  );

  const pending = rows.filter(
    (row) =>
      row.display_name?.trim() === "Pending" && !isIdentityRowComplete(row)
  );

  let backfilled = 0;
  for (const row of pending) {
    const result = await assignBotSdflIdentity(
      supabase,
      leagueId,
      row.user_id,
      backfilled,
      usedTeamNames
    );
    if (result.error) return { backfilled, error: result.error };
    backfilled++;
  }

  return { backfilled };
}

export async function assignBotSdflIdentity(
  supabase: SupabaseClient,
  leagueId: string,
  userId: string,
  slotIndex: number,
  usedTeamNames: Set<string>
): Promise<{ error?: string }> {
  const openSlots = await getOpenSdflSlots(supabase, leagueId);
  const slot = pickFirstOpenSdflSlot(openSlots);
  if (!slot) {
    return { error: "No open SDFL division slots remain." };
  }

  const { city, teamName, colors } = generateBotSdflIdentity(
    slotIndex,
    usedTeamNames
  );
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("league_members")
    .update({
      conference: slot.conference,
      division: slot.division,
      division_slot: slot.divisionSlot,
      franchise_city: city,
      franchise_colors: colors,
      display_name: teamName,
      identity_completed_at: now,
    })
    .eq("league_id", leagueId)
    .eq("user_id", userId);

  if (error) return { error: error.message };
  usedTeamNames.add(teamName.toLowerCase());
  return {};
}
