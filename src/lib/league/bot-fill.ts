import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import {
  ALL_BOT_PERSONALITIES,
  type BotPersonality,
} from "@/lib/league/bots";
import { buildBotConfigForPersonality } from "@/lib/league/league-bots";
import type { LeagueOpponentType, LeagueVisibility } from "@/lib/league/league-config";

const SYNTHETIC_TEAM_NAMES = [
  "Northside Capital",
  "Summit Street",
  "Harborview FC",
  "Lakeview Holdings",
  "Metro Traders",
  "Ridgeline Equity",
  "Westport Markets",
  "Cedar Point Capital",
  "Ironwood Investors",
  "Bayfront Trading",
  "Highland Portfolio",
  "Stonebridge FC",
  "Clearwater Group",
  "Pinecrest Markets",
  "Eastgate Capital",
  "Silverline Trading",
  "Brookfield Equity",
  "Redwood Street",
  "Kingsport Markets",
  "Fairview Holdings",
  "Oakmont Traders",
  "Riverbend Capital",
  "Parkside Portfolio",
  "Granite Hill FC",
  "Seaview Markets",
  "Meadowbrook Capital",
  "Crosswind Trading",
  "Blue Ridge Equity",
  "Milltown Investors",
  "Horizon Street",
  "Beacon Hill Markets",
  "Canyon View Capital",
];

export function shouldFillEmptySlotsWithBots(options: {
  visibility: LeagueVisibility;
  opponentType: LeagueOpponentType;
}): boolean {
  if (options.visibility === "public") return true;
  if (options.opponentType === "all_ai") return true;
  if (options.opponentType === "mixed") return true;
  return false;
}

function pickTeamName(used: Set<string>, index: number): string {
  for (let offset = 0; offset < SYNTHETIC_TEAM_NAMES.length; offset++) {
    const candidate =
      SYNTHETIC_TEAM_NAMES[(index + offset) % SYNTHETIC_TEAM_NAMES.length];
    if (!used.has(candidate.toLowerCase())) {
      used.add(candidate.toLowerCase());
      return candidate;
    }
  }

  const fallback = `Team ${index + 1}`;
  used.add(fallback.toLowerCase());
  return fallback;
}

export type FillEmptySlotsResult = {
  filled: number;
  remainingSlots: number;
  resumedFrom: number;
  error?: string;
};

export async function fillEmptySlotsWithBots(
  leagueId: string,
  playerCount: number,
  options?: {
    supabase?: SupabaseClient;
    /** Cap bots created this invocation; remaining slots resume on the next run. */
    maxBotsPerRun?: number;
  }
): Promise<FillEmptySlotsResult> {
  const supabase = options?.supabase ?? (await createClient());

  const { data: members, error: membersError } = await supabase
    .from("league_members")
    .select("user_id, display_name, draft_slot")
    .eq("league_id", leagueId)
    .order("draft_slot", { ascending: true, nullsFirst: false });

  if (membersError) {
    return {
      filled: 0,
      remainingSlots: playerCount,
      resumedFrom: 0,
      error: membersError.message,
    };
  }

  const existingCount = members?.length ?? 0;
  const slotsToFill = Math.max(0, playerCount - existingCount);
  if (slotsToFill === 0) {
    return { filled: 0, remainingSlots: 0, resumedFrom: existingCount };
  }

  const usedNames = new Set(
    (members ?? [])
      .map((member) => member.display_name?.trim().toLowerCase())
      .filter(Boolean) as string[]
  );

  const maxThisRun = options?.maxBotsPerRun ?? slotsToFill;
  let filled = 0;

  for (let slot = existingCount; slot < playerCount; slot++) {
    if (filled >= maxThisRun) break;

    const personality =
      ALL_BOT_PERSONALITIES[slot % ALL_BOT_PERSONALITIES.length] as BotPersonality;
    const displayName = pickTeamName(usedNames, slot);
    const botConfig = buildBotConfigForPersonality(personality);

    const { data: botId, error } = await supabase.rpc("provision_league_bot", {
      p_league_id: leagueId,
      p_display_name: displayName,
      p_personality: personality,
      p_draft_slot: slot,
      p_bot_config: botConfig,
    });

    if (error || !botId) {
      return {
        filled,
        remainingSlots: Math.max(0, playerCount - existingCount - filled),
        resumedFrom: existingCount,
        error: error?.message ?? "Could not provision league bot.",
      };
    }

    filled += 1;
  }

  return {
    filled,
    remainingSlots: Math.max(0, playerCount - existingCount - filled),
    resumedFrom: existingCount,
  };
}

export async function ensureStandingsForLeagueMembers(
  leagueId: string,
  supabaseOverride?: SupabaseClient
): Promise<{ error?: string }> {
  const supabase = supabaseOverride ?? (await createClient());
  const { data: members } = await supabase
    .from("league_members")
    .select("user_id")
    .eq("league_id", leagueId);

  for (const member of members ?? []) {
    const { data: existing } = await supabase
      .from("league_standings")
      .select("user_id")
      .eq("league_id", leagueId)
      .eq("user_id", member.user_id)
      .maybeSingle();

    if (existing) continue;

    const { error } = await supabase.from("league_standings").insert({
      league_id: leagueId,
      user_id: member.user_id,
      wins: 0,
      losses: 0,
      current_week: 1,
    });

    if (error) return { error: error.message };
  }

  return {};
}

export async function buildDraftOrder(leagueId: string): Promise<string[]> {
  const { resolveDraftOrderForLeague } = await import(
    "@/lib/league/draft-order-server"
  );
  const result = await resolveDraftOrderForLeague(leagueId);
  return result.draftOrder;
}
