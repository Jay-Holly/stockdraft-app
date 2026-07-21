/**
 * Real 2024-25 NBA divisional alignment, keyed by sim_players.real_team /
 * sim_game_results abbreviations (stats.nba.com convention — confirmed live
 * against the seeded sim_players table: GSW/NYK, not the map-marker's GS/NY).
 */
export type NbaConference = "east" | "west";
export type NbaDivision =
  | "atlantic"
  | "central"
  | "southeast"
  | "northwest"
  | "pacific"
  | "southwest";

export const NBA_DIVISION_CONFERENCE: Record<NbaDivision, NbaConference> = {
  atlantic: "east",
  central: "east",
  southeast: "east",
  northwest: "west",
  pacific: "west",
  southwest: "west",
};

export const NBA_ALIGNMENT: Record<NbaDivision, readonly string[]> = {
  atlantic: ["BOS", "BKN", "NYK", "PHI", "TOR"],
  central: ["CHI", "CLE", "DET", "IND", "MIL"],
  southeast: ["ATL", "CHA", "MIA", "ORL", "WAS"],
  northwest: ["DEN", "MIN", "OKC", "POR", "UTA"],
  pacific: ["GSW", "LAC", "LAL", "PHX", "SAC"],
  southwest: ["DAL", "HOU", "MEM", "NOP", "SAS"],
};

/**
 * league_map_slot_claims.slot_key (SDBA_MAP_MARKERS.key, from
 * src/lib/league/sdba-team-map-coords.ts) uses two abbreviations that differ
 * from the sim data: "GS" (sim: GSW) and "NY" (sim: NYK). Every other key is
 * identical to its sim_players.real_team code.
 */
const SLOT_KEY_ALIASES: Record<string, string> = {
  GS: "GSW",
  NY: "NYK",
};

export function resolveNbaRealTeamFromSlotKey(slotKey: string): string {
  return SLOT_KEY_ALIASES[slotKey] ?? slotKey;
}

export function getNbaDivisionForRealTeam(
  realTeam: string
): { conference: NbaConference; division: NbaDivision } | null {
  for (const division of Object.keys(NBA_ALIGNMENT) as NbaDivision[]) {
    if (NBA_ALIGNMENT[division].includes(realTeam)) {
      return { conference: NBA_DIVISION_CONFERENCE[division], division };
    }
  }
  return null;
}
