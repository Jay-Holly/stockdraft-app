/**
 * Marker positions for the 32 SDFL franchise markets, in the 1536x1024
 * pixel space of the /images/league/sdfl-map.png background art.
 * Keyed by display label (not real NFL abbreviations) — see
 * mapRealTeamToDisplayLabel in nfl-team-alignment.ts for the translation
 * from the real team code used for sim-data alignment to what's shown here.
 *
 * Coordinates detected directly from the finished map artwork (circle
 * template match), not hand-placed — replaces the earlier blank-state-map
 * coordinates that were never confirmed against real rendered art.
 */
export const NFL_TEAM_MAP_COORDS: Record<string, { x: number; y: number }> = {
  // AFC East
  BUF: { x: 1257, y: 354 },
  MIA: { x: 1292, y: 999 },
  NE: { x: 1437, y: 325 }, // Boston
  NJ: { x: 1396, y: 421 }, // Jets
  // AFC North
  BAL: { x: 1372, y: 498 },
  CIN: { x: 1145, y: 524 },
  CLE: { x: 1157, y: 428 },
  PIT: { x: 1252, y: 427 },
  // AFC South
  HOU: { x: 799, y: 880 },
  IND: { x: 1044, y: 499 },
  JAX: { x: 1232, y: 821 },
  TEN: { x: 1042, y: 637 }, // Nashville
  // AFC West
  DEN: { x: 525, y: 512 },
  KC: { x: 809, y: 564 },
  SD: { x: 168, y: 716 }, // Chargers (San Diego)
  LV: { x: 271, y: 608 },
  // NFC East
  DAL: { x: 745, y: 772 },
  NY: { x: 1396, y: 382 }, // Giants
  PHI: { x: 1366, y: 458 },
  DC: { x: 1359, y: 545 }, // Commanders (Washington)
  // NFC North
  CHI: { x: 1001, y: 428 },
  DET: { x: 1107, y: 404 },
  GB: { x: 1001, y: 329 },
  MIN: { x: 825, y: 284 },
  // NFC South
  ATL: { x: 1159, y: 734 },
  CAR: { x: 1224, y: 644 }, // Charlotte
  NO: { x: 914, y: 879 },
  TB: { x: 1202, y: 922 },
  // NFC West
  ARI: { x: 322, y: 722 }, // Phoenix
  LA: { x: 129, y: 665 },
  SF: { x: 75, y: 512 },
  SEA: { x: 168, y: 178 },
};

/** Native pixel size of the sdfl-map.png background art. */
export const SDFL_MAP_IMAGE_WIDTH = 1536;
export const SDFL_MAP_IMAGE_HEIGHT = 1024;
