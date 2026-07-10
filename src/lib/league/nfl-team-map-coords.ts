/**
 * Approximate marker positions for the 32 real NFL home markets, in a
 * 1000x600 viewBox roughly matching continental-US proportions. These are
 * stylized relative positions, not precise geographic coordinates — "roughly
 * matching real NFL team locations" per the design spec, not a literal atlas.
 */
export const NFL_TEAM_MAP_COORDS: Record<string, { x: number; y: number }> = {
  // AFC East
  BUF: { x: 795, y: 118 },
  MIA: { x: 828, y: 560 },
  NE: { x: 872, y: 108 },
  NYJ: { x: 808, y: 158 },
  // AFC North
  BAL: { x: 768, y: 188 },
  CIN: { x: 648, y: 222 },
  CLE: { x: 682, y: 168 },
  PIT: { x: 728, y: 180 },
  // AFC South
  HOU: { x: 478, y: 432 },
  IND: { x: 628, y: 248 },
  JAX: { x: 728, y: 458 },
  TEN: { x: 618, y: 338 },
  // AFC West
  DEN: { x: 378, y: 248 },
  KC: { x: 468, y: 258 },
  LAC: { x: 92, y: 352 },
  LV: { x: 148, y: 288 },
  // NFC East
  DAL: { x: 468, y: 398 },
  NYG: { x: 812, y: 152 },
  PHI: { x: 792, y: 168 },
  WAS: { x: 772, y: 198 },
  // NFC North
  CHI: { x: 578, y: 198 },
  DET: { x: 652, y: 168 },
  GB: { x: 568, y: 148 },
  MIN: { x: 518, y: 138 },
  // NFC South
  ATL: { x: 668, y: 378 },
  CAR: { x: 738, y: 338 },
  NO: { x: 568, y: 458 },
  TB: { x: 698, y: 478 },
  // NFC West
  ARI: { x: 218, y: 378 },
  LA: { x: 88, y: 340 },
  SF: { x: 58, y: 248 },
  SEA: { x: 98, y: 88 },
};

/**
 * Simplified, stylized continental-US silhouette — captures the general
 * shape (West/Gulf/East coasts, Great Lakes, Florida, Texas) at a level
 * appropriate for a background canvas behind team markers, not a literal
 * state-boundary atlas.
 */
export const US_MAP_OUTLINE_PATH =
  "M 90,90 L 180,60 L 300,55 L 420,60 L 520,50 L 620,55 L 720,60 " +
  "L 800,75 L 850,95 L 880,115 L 895,150 L 875,185 L 850,175 L 830,195 " +
  "L 845,225 L 820,250 L 800,240 L 795,270 L 815,300 L 800,330 L 780,320 " +
  "L 760,345 L 745,375 L 720,400 L 735,430 L 715,470 L 725,510 L 745,540 " +
  "L 800,560 L 835,580 L 855,600 L 815,595 L 780,570 L 750,545 L 700,520 " +
  "L 660,500 L 610,480 L 560,470 L 500,460 L 460,440 L 420,420 L 380,405 " +
  "L 330,395 L 280,390 L 230,395 L 190,380 L 150,360 L 110,330 L 75,300 " +
  "L 50,270 L 35,230 L 30,190 L 40,150 L 60,115 Z";
