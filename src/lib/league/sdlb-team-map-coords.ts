/**
 * Marker positions for the 30 SDLB franchise markets, in the 1536x1024
 * pixel space of the /images/league/sdlb-map.png background art.
 * Coordinates detected directly from the finished map artwork (circle
 * template match), not hand-placed.
 */
export type SdlbMapMarker = {
  key: string;
  city: string;
  color: "red" | "blue";
  x: number;
  y: number;
};

export const SDLB_MAP_MARKERS: SdlbMapMarker[] = [
  { key: "SEA", city: "Seattle", color: "blue", x: 176, y: 151 },
  { key: "MIN", city: "Minneapolis", color: "blue", x: 826, y: 264 },
  { key: "TOR", city: "Toronto", color: "blue", x: 1231, y: 277 },
  { key: "BOS", city: "Boston", color: "blue", x: 1410, y: 303 },
  { key: "NYA", city: "NY", color: "red", x: 1367, y: 351 },
  { key: "MIL", city: "Milwaukee", color: "red", x: 1005, y: 360 },
  { key: "DET", city: "Detroit", color: "blue", x: 1123, y: 385 },
  { key: "NYB", city: "NY", color: "blue", x: 1361, y: 385 },
  { key: "CHA", city: "Chicago", color: "red", x: 1023, y: 407 },
  { key: "CLE", city: "Cleveland", color: "blue", x: 1164, y: 407 },
  { key: "PIT", city: "Pittsburgh", color: "red", x: 1234, y: 430 },
  { key: "PHI", city: "Philadelphia", color: "red", x: 1362, y: 433 },
  { key: "CHB", city: "Chicago", color: "blue", x: 1027, y: 445 },
  { key: "BAL", city: "Baltimore", color: "blue", x: 1357, y: 464 },
  { key: "CIN", city: "Cincinnati", color: "red", x: 1105, y: 487 },
  { key: "DEN", city: "Denver", color: "red", x: 540, y: 491 },
  { key: "WAS", city: "Washington", color: "red", x: 1351, y: 495 },
  { key: "SF", city: "San Francisco", color: "red", x: 72, y: 496 },
  { key: "KC", city: "Kansas City", color: "blue", x: 809, y: 529 },
  { key: "STL", city: "St. Louis", color: "red", x: 936, y: 544 },
  { key: "LV", city: "Las Vegas", color: "blue", x: 276, y: 555 },
  { key: "LA", city: "Los Angeles", color: "red", x: 119, y: 638 },
  { key: "ANA", city: "Anaheim", color: "blue", x: 158, y: 650 },
  { key: "ATL", city: "Atlanta", color: "red", x: 1146, y: 696 },
  { key: "PHX", city: "Phoenix", color: "red", x: 329, y: 698 },
  { key: "SD", city: "San Diego", color: "red", x: 166, y: 701 },
  { key: "TEX", city: "Arlington", color: "blue", x: 775, y: 765 },
  { key: "HOU", city: "Houston", color: "blue", x: 805, y: 867 },
  { key: "TB", city: "Tampa", color: "blue", x: 1192, y: 894 },
  { key: "MIA", city: "Miami", color: "red", x: 1279, y: 966 },
];

export const SDLB_MAP_IMAGE_WIDTH = 1536;
export const SDLB_MAP_IMAGE_HEIGHT = 1024;
