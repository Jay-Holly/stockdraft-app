/**
 * Real 2024-25 NHL divisional alignment, keyed by sim_players.real_team /
 * sim_game_results abbreviations (api.nhle.com convention — confirmed live
 * against the seeded sim_players table).
 */
export type NhlConference = "east" | "west";
export type NhlDivision = "atlantic" | "metropolitan" | "central" | "pacific";

export const NHL_DIVISION_CONFERENCE: Record<NhlDivision, NhlConference> = {
  atlantic: "east",
  metropolitan: "east",
  central: "west",
  pacific: "west",
};

export const NHL_ALIGNMENT: Record<NhlDivision, readonly string[]> = {
  atlantic: ["BOS", "BUF", "DET", "FLA", "MTL", "OTT", "TBL", "TOR"],
  metropolitan: ["CAR", "CBJ", "NJD", "NYI", "NYR", "PHI", "PIT", "WSH"],
  central: ["CHI", "COL", "DAL", "MIN", "NSH", "STL", "UTA", "WPG"],
  pacific: ["ANA", "CGY", "EDM", "LAK", "SEA", "SJS", "VAN", "VGK"],
};

/**
 * league_map_slot_claims.slot_key (SDHL_MAP_MARKERS.key, from
 * src/lib/league/sdhl-team-map-coords.ts) uses the exact same abbreviations
 * as sim_players.real_team for every NHL team — no aliasing needed, unlike
 * NBA/MLB. Kept as an identity function so callers stay symmetric across
 * all three sports.
 */
export function resolveNhlRealTeamFromSlotKey(slotKey: string): string {
  return slotKey;
}

export function getNhlDivisionForRealTeam(
  realTeam: string
): { conference: NhlConference; division: NhlDivision } | null {
  for (const division of Object.keys(NHL_ALIGNMENT) as NhlDivision[]) {
    if (NHL_ALIGNMENT[division].includes(realTeam)) {
      return { conference: NHL_DIVISION_CONFERENCE[division], division };
    }
  }
  return null;
}
