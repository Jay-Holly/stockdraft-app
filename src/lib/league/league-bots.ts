import { createClient } from "@/lib/supabase/server";
import { DRAFT_POOL_SECTORS } from "@/lib/market/draft-pool";
import type { BotConfig, BotPersonality, BotProfile } from "@/lib/league/bots";
import { BOT_BY_ID, getBotProfile } from "@/lib/league/bots";
import { pickRandomHomerRegion } from "@/lib/league/homer-regions";

export type LeagueBotMember = {
  id: string;
  personality: BotPersonality;
  displayName: string;
  avatarColor: string;
  config: BotConfig;
  draftSlot: number | null;
};

export function buildBotConfigForPersonality(
  personality: BotPersonality
): BotConfig {
  if (personality === "sector_loyalist") {
    const sectors = DRAFT_POOL_SECTORS.filter((s) => s !== "All");
    return {
      sector: sectors[Math.floor(Math.random() * sectors.length)],
    };
  }

  if (personality === "homer") {
    return { region: pickRandomHomerRegion() };
  }

  return {};
}

export async function getLeagueBotMembers(
  leagueId: string
): Promise<LeagueBotMember[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("league_members")
    .select("user_id, bot_personality, bot_config, display_name, draft_slot")
    .eq("league_id", leagueId)
    .not("bot_personality", "is", null)
    .order("draft_slot", { ascending: true, nullsFirst: false });

  if (error || !data) return [];

  return data.map((row) => {
    const profile = BOT_BY_ID.get(row.user_id);
    const personality = (row.bot_personality ??
      profile?.personality) as BotPersonality;

    return {
      id: row.user_id,
      personality,
      displayName: row.display_name ?? profile?.displayName ?? "AI Manager",
      avatarColor: profile?.avatarColor ?? "blue",
      config: (row.bot_config ?? {}) as BotConfig,
      draftSlot: row.draft_slot,
    };
  });
}

export function resolveSelectedBots(
  personalities: BotPersonality[]
): BotProfile[] {
  return personalities.map((personality) => getBotProfile(personality));
}
