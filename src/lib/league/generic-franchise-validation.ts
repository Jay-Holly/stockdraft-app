import type { GenericMapSport } from "@/lib/league/generic-team-map";

export type FranchiseColors = {
  primary: string;
  secondary: string;
};

/** Real NBA team nicknames — blocked in franchise team names (substring, case-insensitive). */
export const NBA_BLOCKED_NICKNAMES = [
  "Hawks",
  "Celtics",
  "Nets",
  "Hornets",
  "Bulls",
  "Cavaliers",
  "Mavericks",
  "Nuggets",
  "Pistons",
  "Warriors",
  "Rockets",
  "Pacers",
  "Clippers",
  "Lakers",
  "Grizzlies",
  "Heat",
  "Bucks",
  "Timberwolves",
  "Pelicans",
  "Knicks",
  "Thunder",
  "Magic",
  "76ers",
  "Sixers",
  "Suns",
  "Trail Blazers",
  "Blazers",
  "Kings",
  "Spurs",
  "Raptors",
  "Jazz",
  "Wizards",
] as const;

/** Real NHL team nicknames — blocked in franchise team names (substring, case-insensitive). */
export const NHL_BLOCKED_NICKNAMES = [
  "Ducks",
  "Coyotes",
  "Bruins",
  "Sabres",
  "Flames",
  "Hurricanes",
  "Blackhawks",
  "Avalanche",
  "Blue Jackets",
  "Stars",
  "Red Wings",
  "Oilers",
  "Panthers",
  "Kings",
  "Wild",
  "Canadiens",
  "Predators",
  "Devils",
  "Islanders",
  "Rangers",
  "Senators",
  "Flyers",
  "Penguins",
  "Sharks",
  "Kraken",
  "Blues",
  "Lightning",
  "Maple Leafs",
  "Canucks",
  "Golden Knights",
  "Capitals",
  "Jets",
  "Mammoth",
] as const;

/** Real MLB team nicknames — blocked in franchise team names (substring, case-insensitive). */
export const MLB_BLOCKED_NICKNAMES = [
  "Diamondbacks",
  "Braves",
  "Orioles",
  "Red Sox",
  "Cubs",
  "White Sox",
  "Reds",
  "Guardians",
  "Rockies",
  "Tigers",
  "Astros",
  "Royals",
  "Angels",
  "Dodgers",
  "Marlins",
  "Brewers",
  "Twins",
  "Mets",
  "Yankees",
  "Athletics",
  "Phillies",
  "Pirates",
  "Padres",
  "Giants",
  "Mariners",
  "Cardinals",
  "Rays",
  "Rangers",
  "Blue Jays",
  "Nationals",
] as const;

const BLOCKED_NICKNAMES_BY_SPORT: Record<GenericMapSport, readonly string[]> = {
  nba: NBA_BLOCKED_NICKNAMES,
  nhl: NHL_BLOCKED_NICKNAMES,
  mlb: MLB_BLOCKED_NICKNAMES,
};

export function validateFranchiseCity(city: string): string | null {
  const trimmed = city.trim();
  if (!trimmed) return "City is required.";
  if (trimmed.length > 60) return "City must be 60 characters or fewer.";
  return null;
}

export function validateFranchiseTeamName(
  teamName: string,
  sport: GenericMapSport
): string | null {
  const trimmed = teamName.trim();
  if (!trimmed) return "Team name is required.";
  if (trimmed.length > 40) return "Team name must be 40 characters or fewer.";

  const lower = trimmed.toLowerCase();
  const blocked = BLOCKED_NICKNAMES_BY_SPORT[sport];
  const sportLabel = sport.toUpperCase();
  for (const nickname of blocked) {
    if (lower.includes(nickname.toLowerCase())) {
      return `Team name cannot include the ${sportLabel} nickname "${nickname}".`;
    }
  }

  return null;
}

export function validateFranchiseColors(colors: unknown): FranchiseColors | string {
  if (!colors || typeof colors !== "object") {
    return "Color scheme is required.";
  }

  const record = colors as Record<string, unknown>;
  const primary = typeof record.primary === "string" ? record.primary.trim() : "";
  const secondary =
    typeof record.secondary === "string" ? record.secondary.trim() : "";

  const hexRe = /^#[0-9a-fA-F]{6}$/;
  if (!hexRe.test(primary)) return "Primary color must be a valid hex code.";
  if (!hexRe.test(secondary)) return "Secondary color must be a valid hex code.";
  if (primary.toLowerCase() === secondary.toLowerCase()) {
    return "Primary and secondary colors must differ.";
  }

  return { primary, secondary };
}
