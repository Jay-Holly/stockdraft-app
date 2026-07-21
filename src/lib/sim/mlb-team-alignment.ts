/**
 * Real 2024 MLB divisional alignment, keyed by sim_players.real_team /
 * sim_game_results abbreviations (MLB StatsAPI convention — confirmed live
 * against the seeded sim_players table).
 */
export type MlbConference = "al" | "nl";
export type MlbDivision = "east" | "central" | "west";

export const MLB_ALIGNMENT: Record<
  MlbConference,
  Record<MlbDivision, readonly string[]>
> = {
  al: {
    east: ["BAL", "BOS", "NYY", "TB", "TOR"],
    central: ["CWS", "CLE", "DET", "KC", "MIN"],
    west: ["HOU", "LAA", "OAK", "SEA", "TEX"],
  },
  nl: {
    east: ["ATL", "MIA", "NYM", "PHI", "WSH"],
    central: ["CHC", "CIN", "MIL", "PIT", "STL"],
    west: ["AZ", "COL", "LAD", "SD", "SF"],
  },
};

/**
 * league_map_slot_claims.slot_key (SDLB_MAP_MARKERS.key, from
 * src/lib/league/sdlb-team-map-coords.ts) uses several abbreviations that
 * differ from the sim data, mostly to disambiguate shared-city markets
 * (two Chicago dots, two New York dots) or reflect the map's city label
 * instead of the team's league code:
 *   ANA -> LAA (Angels, city marker uses their Anaheim home city)
 *   CHA -> CWS (White Sox, "Chicago" red marker)
 *   CHB -> CHC (Cubs, "Chicago" blue marker)
 *   DEN -> COL (Rockies, Denver)
 *   LA  -> LAD (Dodgers, "Los Angeles" marker distinct from Angels' ANA)
 *   LV  -> OAK (Athletics — 2024 season was still played in Oakland; the
 *               map marker anticipates the Las Vegas relocation)
 *   NYA -> NYY (Yankees)
 *   NYB -> NYM (Mets)
 *   PHX -> AZ  (Diamondbacks)
 *   WAS -> WSH (Nationals)
 * Every other key is identical to its sim_players.real_team code.
 */
const SLOT_KEY_ALIASES: Record<string, string> = {
  ANA: "LAA",
  CHA: "CWS",
  CHB: "CHC",
  DEN: "COL",
  LA: "LAD",
  LV: "OAK",
  NYA: "NYY",
  NYB: "NYM",
  PHX: "AZ",
  WAS: "WSH",
};

export function resolveMlbRealTeamFromSlotKey(slotKey: string): string {
  return SLOT_KEY_ALIASES[slotKey] ?? slotKey;
}

export function getMlbDivisionForRealTeam(
  realTeam: string
): { conference: MlbConference; division: MlbDivision } | null {
  for (const conference of Object.keys(MLB_ALIGNMENT) as MlbConference[]) {
    for (const division of Object.keys(
      MLB_ALIGNMENT[conference]
    ) as MlbDivision[]) {
      if (MLB_ALIGNMENT[conference][division].includes(realTeam)) {
        return { conference, division };
      }
    }
  }
  return null;
}
