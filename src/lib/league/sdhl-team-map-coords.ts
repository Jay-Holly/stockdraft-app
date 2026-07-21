/**
 * Marker positions for the 32 SDHL franchise markets, in the 1536x1024
 * pixel space of the /images/league/sdhl-map.png background art.
 * Coordinates detected directly from the finished map artwork (circle
 * template match), not hand-placed.
 */
export type SdhlMapMarker = {
  key: string;
  city: string;
  color: "red" | "blue";
  x: number;
  y: number;
};

export const SDHL_MAP_MARKERS: SdhlMapMarker[] = [
  { key: "EDM", city: "Edmonton", color: "red", x: 319, y: 262 },
  { key: "VAN", city: "Vancouver", color: "red", x: 133, y: 325 },
  { key: "MTL", city: "Montreal", color: "blue", x: 1145, y: 329 },
  { key: "CGY", city: "Calgary", color: "red", x: 318, y: 336 },
  { key: "WPG", city: "Winnipeg", color: "red", x: 616, y: 377 },
  { key: "OTT", city: "Ottawa", color: "blue", x: 1129, y: 387 },
  { key: "SEA", city: "Seattle", color: "red", x: 141, y: 398 },
  { key: "TOR", city: "Toronto", color: "blue", x: 1129, y: 457 },
  { key: "MIN", city: "Minnesota", color: "red", x: 699, y: 470 },
  { key: "BUF", city: "Buffalo", color: "blue", x: 1129, y: 500 },
  { key: "BOS", city: "Boston", color: "blue", x: 1290, y: 502 },
  { key: "NYR", city: "New York 1", color: "blue", x: 1261, y: 544 },
  { key: "DET", city: "Detroit", color: "red", x: 1021, y: 556 },
  { key: "NYI", city: "New York 2", color: "blue", x: 1261, y: 574 },
  { key: "CHI", city: "Chicago", color: "red", x: 831, y: 586 },
  { key: "PIT", city: "Pittsburgh", color: "blue", x: 1100, y: 595 },
  { key: "NJD", city: "New Jersey", color: "blue", x: 1260, y: 604 },
  { key: "UTA", city: "Utah", color: "red", x: 306, y: 606 },
  { key: "CBJ", city: "Columbus", color: "blue", x: 986, y: 625 },
  { key: "PHI", city: "Philadelphia", color: "blue", x: 1258, y: 635 },
  { key: "SJS", city: "San Jose", color: "red", x: 74, y: 643 },
  { key: "COL", city: "Colorado", color: "red", x: 439, y: 649 },
  { key: "WSH", city: "Washington", color: "blue", x: 1198, y: 666 },
  { key: "STL", city: "St. Louis", color: "red", x: 826, y: 681 },
  { key: "VGK", city: "Vegas", color: "red", x: 216, y: 689 },
  { key: "CAR", city: "Carolina", color: "blue", x: 1173, y: 736 },
  { key: "NSH", city: "Nashville", color: "red", x: 952, y: 737 },
  { key: "LAK", city: "Los Angeles", color: "red", x: 124, y: 744 },
  { key: "ANA", city: "Anaheim", color: "red", x: 139, y: 777 },
  { key: "DAL", city: "Dallas", color: "red", x: 624, y: 838 },
  { key: "TBL", city: "Tampa Bay", color: "blue", x: 1086, y: 931 },
  { key: "FLA", city: "Miami", color: "blue", x: 1166, y: 972 },
];

export const SDHL_MAP_IMAGE_WIDTH = 1536;
export const SDHL_MAP_IMAGE_HEIGHT = 1024;
