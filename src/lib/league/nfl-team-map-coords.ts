/**
 * Marker positions for the 32 SDFL franchise markets, in the 1536x1024
 * pixel space of the /images/league/sdfl-us-map.png background art.
 * Keyed by display label (not real NFL abbreviations) — see
 * mapRealTeamToDisplayLabel in nfl-team-alignment.ts for the translation
 * from the real team code used for sim-data alignment to what's shown here.
 */
export const NFL_TEAM_MAP_COORDS: Record<string, { x: number; y: number }> = {
  // AFC East
  BUF: { x: 1250, y: 225 },
  MIA: { x: 1245, y: 900 },
  NE: { x: 1400, y: 245 },
  NJ: { x: 1400, y: 340 }, // Jets
  // AFC North
  BAL: { x: 1418, y: 478 },
  CIN: { x: 1090, y: 440 },
  CLE: { x: 1120, y: 340 },
  PIT: { x: 1210, y: 350 },
  // AFC South
  HOU: { x: 700, y: 800 },
  IND: { x: 1042, y: 428 },
  JAX: { x: 1200, y: 780 },
  TEN: { x: 1010, y: 545 },
  // AFC West
  DEN: { x: 540, y: 510 },
  KC: { x: 700, y: 470 },
  SD: { x: 150, y: 600 }, // Chargers (San Diego)
  LV: { x: 195, y: 420 },
  // NFC East
  DAL: { x: 640, y: 700 },
  NY: { x: 1360, y: 305 }, // Giants
  PHI: { x: 1290, y: 400 },
  DC: { x: 1375, y: 405 }, // Commanders
  // NFC North
  CHI: { x: 953, y: 428 },
  DET: { x: 1073, y: 305 },
  GB: { x: 895, y: 230 },
  MIN: { x: 775, y: 180 },
  // NFC South
  ATL: { x: 1152, y: 700 },
  CAR: { x: 1268, y: 555 },
  NO: { x: 870, y: 745 },
  TB: { x: 1200, y: 830 },
  // NFC West
  ARI: { x: 260, y: 570 },
  LA: { x: 105, y: 565 },
  SF: { x: 75, y: 410 },
  SEA: { x: 170, y: 75 },
};

/** Native pixel size of the sdfl-us-map.png background art. */
export const SDFL_MAP_IMAGE_WIDTH = 1536;
export const SDFL_MAP_IMAGE_HEIGHT = 1024;
