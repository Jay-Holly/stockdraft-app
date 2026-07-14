import type {
  SdflConference,
  SdflDivision,
} from "@/lib/league/sdfl-divisions";

/**
 * Real 2024 NFL divisional alignment, keyed by the same abbreviations used
 * in sim_team_schedule/sim_game_results. SDAL mirrors AFC, SDNL mirrors NFC
 * (confirmed convention); within a division, the 4 real teams map to
 * division slots 1-4 alphabetically by abbreviation (confirmed convention)
 * — the only deterministic ordering not otherwise implied by the design.
 */
const REAL_NFL_ALIGNMENT: Record<
  SdflConference,
  Record<SdflDivision, readonly [string, string, string, string]>
> = {
  sdal: {
    east: ["BUF", "MIA", "NE", "NYJ"],
    north: ["BAL", "CIN", "CLE", "PIT"],
    south: ["HOU", "IND", "JAX", "TEN"],
    west: ["DEN", "KC", "LAC", "LV"],
  },
  sdnl: {
    east: ["DAL", "NYG", "PHI", "WAS"],
    north: ["CHI", "DET", "GB", "MIN"],
    south: ["ATL", "CAR", "NO", "TB"],
    west: ["ARI", "LA", "SF", "SEA"],
  },
};

export function mapSdflSlotToRealTeam(
  conference: SdflConference,
  division: SdflDivision,
  divisionSlot: number
): string | null {
  const teams = REAL_NFL_ALIGNMENT[conference]?.[division];
  if (!teams) return null;
  return teams[divisionSlot - 1] ?? null;
}

/**
 * UI-safe market label for a real team code — never shown to users as the
 * actual NFL abbreviation for markets that name a specific franchise (NYJ,
 * NYG, WAS, LAC). Everything else already reads as a plain city/region
 * code, not a team identity, so it passes through unchanged. Only use this
 * for display (map labels, tooltips) — sim data alignment (schedule,
 * injuries) keys off the real team code from mapSdflSlotToRealTeam.
 */
const DISPLAY_LABEL_OVERRIDES: Record<string, string> = {
  NYJ: "NJ",
  NYG: "NY",
  WAS: "DC",
  LAC: "SD",
};

export function mapRealTeamToDisplayLabel(team: string): string {
  return DISPLAY_LABEL_OVERRIDES[team] ?? team;
}

export type SdflSlot = {
  conference: SdflConference;
  division: SdflDivision;
  divisionSlot: number;
};

/** Reverse lookup, built once per call site — real team abbreviation -> SDFL slot. */
export function buildRealTeamToSdflSlotMap(): Map<string, SdflSlot> {
  const map = new Map<string, SdflSlot>();
  for (const conference of Object.keys(REAL_NFL_ALIGNMENT) as SdflConference[]) {
    for (const division of Object.keys(
      REAL_NFL_ALIGNMENT[conference]
    ) as SdflDivision[]) {
      const teams = REAL_NFL_ALIGNMENT[conference][division];
      teams.forEach((team, index) => {
        map.set(team, { conference, division, divisionSlot: index + 1 });
      });
    }
  }
  return map;
}
