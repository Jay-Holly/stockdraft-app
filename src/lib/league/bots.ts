export type BotPersonality =
  | "analyst"
  | "gambler"
  | "crypto_king"
  | "value_hunter"
  | "sector_loyalist"
  | "contrarian"
  | "momentum_chaser"
  | "diversifier"
  | "day_trader"
  | "sleeper"
  | "homer"
  | "bench_hoarder";

export type BotConfig = {
  sector?: string;
  region?: string;
};

export type BotProfile = {
  id: string;
  personality: BotPersonality;
  displayName: string;
  teamName: string;
  avatarColor: string;
  description: string;
  strategySummary: string;
};

export const AI_BOTS: BotProfile[] = [
  {
    id: "a1000001-0001-4001-8001-000000000001",
    personality: "analyst",
    displayName: "The Analyst",
    teamName: "The Analyst",
    avatarColor: "blue",
    description: "Methodical and data-driven.",
    strategySummary: "Drafts the highest market-cap stock available every turn.",
  },
  {
    id: "a1000001-0001-4001-8001-000000000002",
    personality: "gambler",
    displayName: "The Gambler",
    teamName: "The Gambler",
    avatarColor: "red",
    description: "High risk, high reward.",
    strategySummary:
      "Avoids the Top 100 and hunts lottery-tier mid-cap volatility.",
  },
  {
    id: "a1000001-0001-4001-8001-000000000003",
    personality: "crypto_king",
    displayName: "The Crypto King",
    teamName: "The Crypto King",
    avatarColor: "gold",
    description: "All-in on crypto, pushback be damned.",
    strategySummary:
      "Dumps the full $200K crypto pool into one coin early and accepts pushback.",
  },
  {
    id: "a1000001-0001-4001-8001-000000000004",
    personality: "value_hunter",
    displayName: "The Value Hunter",
    teamName: "The Value Hunter",
    avatarColor: "green",
    description: "Buys the dip, always.",
    strategySummary:
      "Targets beaten-down stocks trading below recent averages (biggest % declines).",
  },
  {
    id: "a1000001-0001-4001-8001-000000000005",
    personality: "sector_loyalist",
    displayName: "The Sector Loyalist",
    teamName: "The Sector Loyalist",
    avatarColor: "purple",
    description: "One sector to rule them all.",
    strategySummary:
      "Drafts almost entirely from a single GICS sector assigned at league start.",
  },
  {
    id: "a1000001-0001-4001-8001-000000000006",
    personality: "contrarian",
    displayName: "The Contrarian",
    teamName: "The Contrarian",
    avatarColor: "orange",
    description: "When others panic, they buy.",
    strategySummary:
      "Targets whatever dropped the most recently — fading the crowd.",
  },
  {
    id: "a1000001-0001-4001-8001-000000000007",
    personality: "momentum_chaser",
    displayName: "The Momentum Chaser",
    teamName: "The Momentum Chaser",
    avatarColor: "cyan",
    description: "Ride the wave.",
    strategySummary: "Only drafts stocks that are currently trending up.",
  },
  {
    id: "a1000001-0001-4001-8001-000000000008",
    personality: "diversifier",
    displayName: "The Diversifier",
    teamName: "The Diversifier",
    avatarColor: "teal",
    description: "Balance across every sector.",
    strategySummary:
      "Spreads stock picks evenly across all 11 GICS sectors.",
  },
  {
    id: "a1000001-0001-4001-8001-000000000009",
    personality: "day_trader",
    displayName: "The Day Trader",
    teamName: "The Day Trader",
    avatarColor: "yellow",
    description: "Safe stocks, wild crypto.",
    strategySummary:
      "Conservative blue-chip stock draft with constant crypto trading all season.",
  },
  {
    id: "a1000001-0001-4001-8001-000000000010",
    personality: "sleeper",
    displayName: "The Sleeper",
    teamName: "The Sleeper",
    avatarColor: "pink",
    description: "Hidden gems outside the spotlight.",
    strategySummary:
      "Targets strong mid-cap fundamentals outside the Top 100.",
  },
  {
    id: "a1000001-0001-4001-8001-000000000011",
    personality: "homer",
    displayName: "The Homer",
    teamName: "The Homer",
    avatarColor: "indigo",
    description: "Local pride on the roster.",
    strategySummary:
      "Drafts stocks headquartered near a home region assigned at league start.",
  },
  {
    id: "a1000001-0001-4001-8001-000000000012",
    personality: "bench_hoarder",
    displayName: "The Bench Hoarder",
    teamName: "The Bench Hoarder",
    avatarColor: "slate",
    description: "Safe starters, spicy bench.",
    strategySummary:
      "Blue-chip open-round picks with high-risk lottery tickets on the bench.",
  },
];

export const BOT_BY_ID = new Map(AI_BOTS.map((b) => [b.id, b]));
export const BOT_BY_PERSONALITY = new Map(AI_BOTS.map((b) => [b.personality, b]));

export const ALL_BOT_PERSONALITIES = AI_BOTS.map((b) => b.personality);

export function isBotPersonality(value: string): value is BotPersonality {
  return BOT_BY_PERSONALITY.has(value as BotPersonality);
}

export function getBotProfile(personality: BotPersonality): BotProfile {
  const bot = BOT_BY_PERSONALITY.get(personality);
  if (!bot) throw new Error(`Unknown bot personality: ${personality}`);
  return bot;
}
