/**
 * Marker positions for the 30 SDBA franchise markets, in the 1536x1024
 * pixel space of the /images/league/sdba-map.png background art.
 * Coordinates detected directly from the finished map artwork (circle
 * template match), not hand-placed.
 */
export type SdbaMapMarker = {
  key: string;
  city: string;
  color: "red" | "blue";
  x: number;
  y: number;
};

export const SDBA_MAP_MARKERS: SdbaMapMarker[] = [
  { key: "POR", city: "Portland", color: "red", x: 126, y: 197 },
  { key: "MIN", city: "Minnesota", color: "red", x: 820, y: 253 },
  { key: "TOR", city: "Toronto", color: "blue", x: 1238, y: 290 },
  { key: "BOS", city: "Boston", color: "blue", x: 1444, y: 293 },
  { key: "MIL", city: "Milwaukee", color: "blue", x: 1021, y: 320 },
  { key: "BKN", city: "Brooklyn", color: "blue", x: 1391, y: 349 },
  { key: "DET", city: "Detroit", color: "blue", x: 1142, y: 368 },
  { key: "NY", city: "New York", color: "blue", x: 1382, y: 380 },
  { key: "CHI", city: "Chicago", color: "blue", x: 1022, y: 383 },
  { key: "CLE", city: "Cleveland", color: "blue", x: 1176, y: 389 },
  { key: "PHI", city: "Philadelphia", color: "blue", x: 1369, y: 414 },
  { key: "UTA", city: "Utah", color: "red", x: 348, y: 419 },
  { key: "SAC", city: "Sacramento", color: "red", x: 76, y: 429 },
  { key: "IND", city: "Indiana", color: "blue", x: 1074, y: 446 },
  { key: "DEN", city: "Denver", color: "red", x: 511, y: 456 },
  { key: "WAS", city: "Washington", color: "blue", x: 1319, y: 464 },
  { key: "GS", city: "Golden State", color: "red", x: 65, y: 469 },
  { key: "LAL", city: "LA", color: "red", x: 72, y: 527 },
  { key: "OKC", city: "Oklahoma City", color: "red", x: 715, y: 560 },
  { key: "LAC", city: "East LA", color: "red", x: 95, y: 569 },
  { key: "CHA", city: "Charlotte", color: "blue", x: 1228, y: 583 },
  { key: "MEM", city: "Memphis", color: "red", x: 956, y: 609 },
  { key: "PHX", city: "Phoenix", color: "red", x: 297, y: 636 },
  { key: "ATL", city: "Atlanta", color: "blue", x: 1138, y: 655 },
  { key: "DAL", city: "Dallas", color: "red", x: 726, y: 692 },
  { key: "ORL", city: "Orlando", color: "blue", x: 1233, y: 782 },
  { key: "SAS", city: "San Antonio", color: "red", x: 671, y: 795 },
  { key: "HOU", city: "Houston", color: "red", x: 785, y: 795 },
  { key: "NOP", city: "New Orleans", color: "red", x: 913, y: 799 },
  { key: "MIA", city: "Miami", color: "blue", x: 1278, y: 907 },
];

export const SDBA_MAP_IMAGE_WIDTH = 1536;
export const SDBA_MAP_IMAGE_HEIGHT = 1024;
