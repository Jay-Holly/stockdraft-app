import { fetchDraftPool } from "@/lib/draft-pool/server";
import { decideAiPick, isDraftStateComplete } from "@/lib/draft/ai-strategy";
import {
  loadDraftStateDetailed,
  makeDraftPickForLeague,
  processPushbackSkipForLeague,
} from "@/lib/draft/server";
import { BOT_BY_ID } from "@/lib/league/bots";
import type { BotConfig, BotPersonality } from "@/lib/league/bots";
import { getLeagueBotMembers } from "@/lib/league/league-bots";

const MAX_AI_PICKS = 200;

export async function runBotDraftToCompletion(
  leagueId: string,
  botUserId: string,
  personality: BotPersonality,
  botConfig: BotConfig = {}
): Promise<{ error?: string; picksMade: number }> {
  const pool = await fetchDraftPool();
  let picksMade = 0;

  for (let i = 0; i < MAX_AI_PICKS; i++) {
    let stateResult = await loadDraftStateDetailed(botUserId, { leagueId });

    while (stateResult.ok && stateResult.state.turn.type === "pushback_skip") {
      const skipResult = await processPushbackSkipForLeague(
        botUserId,
        leagueId
      );
      if (skipResult.error) return { error: skipResult.error, picksMade };
      stateResult = await loadDraftStateDetailed(botUserId, { leagueId });
    }

    if (!stateResult.ok) {
      return { error: stateResult.error, picksMade };
    }

    const state = stateResult.state;
    if (isDraftStateComplete(state)) break;

    const decision = await decideAiPick(personality, state, pool, botConfig);
    if (!decision) {
      return {
        error: `AI could not decide a pick for ${BOT_BY_ID.get(botUserId)?.displayName ?? personality}`,
        picksMade,
      };
    }

    const result = await makeDraftPickForLeague(
      botUserId,
      leagueId,
      decision.symbol,
      decision.allocation,
      decision.price,
      decision.isSearchPick ?? false
    );

    if (result.error) {
      return { error: result.error, picksMade };
    }

    picksMade += 1;
    if (result.complete) break;
  }

  return { picksMade };
}

export async function runAllAiBotDrafts(
  leagueId: string
): Promise<{ errors: string[] }> {
  const errors: string[] = [];
  const bots = await getLeagueBotMembers(leagueId);

  for (const bot of bots) {
    const { error } = await runBotDraftToCompletion(
      leagueId,
      bot.id,
      bot.personality,
      bot.config
    );
    if (error) errors.push(`${bot.displayName}: ${error}`);
  }

  return { errors };
}
