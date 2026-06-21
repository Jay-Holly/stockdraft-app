import { fetchDraftPool } from "@/lib/draft-pool/server";
import { decideAiPick } from "@/lib/draft/ai-strategy";
import {
  formatMoney,
  isCryptoSymbol,
  isStockPickEligible,
} from "@/lib/draft/engine";
import {
  loadDraftStateDetailed,
  makeDraftPickForLeague,
  processAllPushbackSkips,
} from "@/lib/draft/server";
import type { DraftFeedEvent, DraftPick, LiveDraftView } from "@/lib/draft/types";
import type { BotConfig, BotPersonality } from "@/lib/league/bots";
import { fetchFinnhubQuote } from "@/lib/finnhub/service";
import { BOT_BY_ID } from "@/lib/league/bots";
import { getLeagueBotMembers } from "@/lib/league/league-bots";
import { getFallbackStockQuote } from "@/lib/market/fallback-quotes";
import { createClient } from "@/lib/supabase/server";

export type LeagueDraftStateRow = {
  league_id: string;
  status: "waiting" | "in_progress" | "complete";
  draft_order: string[];
  current_pick_index: number;
  total_pick_slots: number;
  on_clock_user_id: string | null;
  pick_deadline_at: string | null;
  global_pick_number: number;
  started_at: string;
  updated_at: string;
};

export type { DraftFeedEvent, LiveDraftView };

const BOT_PICK_DELAY_MS = 1500;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isBotUserId(userId: string): boolean {
  return BOT_BY_ID.has(userId);
}

export function formatDraftEventMessage(
  teamName: string,
  roundNumber: number,
  pick: {
    symbol: string;
    pick_type: string;
    budget_spent: number;
    surcharge_percent: number;
  }
): string {
  if (pick.pick_type === "skip") {
    return `Round ${roundNumber} — ${teamName} skipped (crypto pushback)`;
  }

  if (pick.pick_type === "crypto") {
    const surcharge =
      pick.surcharge_percent > 0
        ? `, ${pick.surcharge_percent}% surcharge`
        : "";
    return `Round ${roundNumber} — ${teamName} drafted ${pick.symbol} (${formatMoney(pick.budget_spent)}${surcharge})`;
  }

  if (pick.pick_type === "bench") {
    return `Round ${roundNumber} — ${teamName} bench pick ${pick.symbol} (free)`;
  }

  return `Round ${roundNumber} — ${teamName} drafted ${pick.symbol} (${formatMoney(pick.budget_spent)})`;
}

async function getTeamName(
  supabase: Awaited<ReturnType<typeof createClient>>,
  leagueId: string,
  userId: string
): Promise<string> {
  const bot = BOT_BY_ID.get(userId);
  if (bot) return bot.displayName;

  const { data } = await supabase
    .from("league_members")
    .select("display_name")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .maybeSingle();

  if (data?.display_name) return data.display_name;

  const { data: profile } = await supabase
    .from("profiles")
    .select("team_name")
    .eq("id", userId)
    .maybeSingle();

  return profile?.team_name ?? "Unknown Team";
}

export async function getLeagueDraftStateRow(
  leagueId: string
): Promise<LeagueDraftStateRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_league_draft_state", {
    p_league_id: leagueId,
  });

  if (error || !data) {
    const { data: direct } = await supabase
      .from("league_draft_state")
      .select("*")
      .eq("league_id", leagueId)
      .maybeSingle();
    return (direct as LeagueDraftStateRow | null) ?? null;
  }

  return data as LeagueDraftStateRow;
}

export async function getDraftFeed(
  leagueId: string,
  limit = 100
): Promise<DraftFeedEvent[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_league_draft_feed", {
    p_league_id: leagueId,
    p_limit: limit,
  });

  if (error || !data) {
    const { data: direct } = await supabase
      .from("league_draft_events")
      .select("*")
      .eq("league_id", leagueId)
      .order("global_pick_number", { ascending: true })
      .limit(limit);
    return (direct ?? []) as DraftFeedEvent[];
  }

  return data as DraftFeedEvent[];
}

export async function buildLiveDraftView(
  leagueId: string,
  viewerUserId: string
): Promise<LiveDraftView | null> {
  const state = await getLeagueDraftStateRow(leagueId);
  if (!state) return null;

  const supabase = await createClient();
  const draftOrder = await Promise.all(
    state.draft_order.map(async (userId) => ({
      userId,
      teamName: await getTeamName(supabase, leagueId, userId),
      isBot: isBotUserId(userId),
    }))
  );

  const onClockTeamName = state.on_clock_user_id
    ? draftOrder.find((t) => t.userId === state.on_clock_user_id)?.teamName ??
      (await getTeamName(supabase, leagueId, state.on_clock_user_id))
    : null;

  return {
    status: state.status,
    onClockUserId: state.on_clock_user_id,
    onClockTeamName,
    pickDeadlineAt: state.pick_deadline_at,
    isMyTurn: state.on_clock_user_id === viewerUserId,
    currentPickIndex: state.current_pick_index,
    totalPickSlots: state.total_pick_slots,
    globalPickNumber: state.global_pick_number,
    draftOrder,
  };
}

export async function isLiveDraftLeague(leagueId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("leagues")
    .select("draft_format")
    .eq("id", leagueId)
    .maybeSingle();

  return data?.draft_format === "live";
}

export async function startLiveDraft(
  leagueId: string,
  humanUserId: string,
  pickTimeSeconds = 120
): Promise<{ error?: string }> {
  const supabase = await createClient();

  const leagueBots = await getLeagueBotMembers(leagueId);
  const draftOrder = [humanUserId, ...leagueBots.map((b) => b.id)];
  const totalPickSlots = draftOrder.length * 15;

  for (let i = 0; i < draftOrder.length; i++) {
    await supabase
      .from("league_members")
      .update({ draft_slot: i })
      .eq("league_id", leagueId)
      .eq("user_id", draftOrder[i]);
  }

  await supabase
    .from("leagues")
    .update({ draft_format: "live", pick_time_seconds: pickTimeSeconds })
    .eq("id", leagueId);

  const { error } = await supabase.from("league_draft_state").insert({
    league_id: leagueId,
    status: "in_progress",
    draft_order: draftOrder,
    current_pick_index: 0,
    total_pick_slots: totalPickSlots,
    global_pick_number: 0,
  });

  if (error) return { error: error.message };

  return assignOnClock(leagueId);
}

async function recordDraftEvent(
  leagueId: string,
  userId: string,
  pick: DraftPick,
  globalPickNumber: number,
  isAutoPick: boolean
): Promise<void> {
  const supabase = await createClient();
  const teamName = await getTeamName(supabase, leagueId, userId);
  const message = formatDraftEventMessage(teamName, pick.round_number, pick);

  await supabase.from("league_draft_events").insert({
    league_id: leagueId,
    user_id: userId,
    team_name: teamName,
    round_number: pick.round_number,
    symbol: pick.symbol,
    pick_type: pick.pick_type,
    budget_spent: pick.budget_spent,
    surcharge_percent: pick.surcharge_percent,
    global_pick_number: globalPickNumber,
    message,
    is_auto_pick: isAutoPick,
  });

  await supabase
    .from("draft_picks")
    .update({
      global_pick_number: globalPickNumber,
      is_auto_pick: isAutoPick,
    })
    .eq("id", pick.id);
}


async function prepareTeamOnClock(
  leagueId: string,
  userId: string,
  depth = 0
): Promise<{ ready: boolean; complete: boolean; error?: string }> {
  if (depth > 15) return { ready: false, complete: false, error: "Too many pushback skips" };

  const skipResult = await processAllPushbackSkips(userId, { leagueId });
  if (skipResult.error) return { ready: false, complete: false, error: skipResult.error };

  const state = await loadDraftStateDetailed(userId, { leagueId });
  if (!state.ok) return { ready: false, complete: false, error: state.error };

  if (
    state.state.draft.status === "complete" ||
    state.state.turn.type === "complete"
  ) {
    return { ready: false, complete: true };
  }

  if (state.state.turn.type === "pushback_skip") {
    return prepareTeamOnClock(leagueId, userId, depth + 1);
  }

  return { ready: true, complete: false };
}

export async function assignOnClock(
  leagueId: string
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const state = await getLeagueDraftStateRow(leagueId);
  if (!state || state.status === "complete") return {};

  const { data: league } = await supabase
    .from("leagues")
    .select("pick_time_seconds")
    .eq("id", leagueId)
    .single();

  const pickTimeSeconds = league?.pick_time_seconds ?? 120;
  let pickIndex = state.current_pick_index;

  while (pickIndex < state.total_pick_slots) {
    const teamIndex = pickIndex % state.draft_order.length;
    const userId = state.draft_order[teamIndex];

    const prepared = await prepareTeamOnClock(leagueId, userId);
    if (prepared.error) return { error: prepared.error };

    if (prepared.complete) {
      pickIndex += 1;
      continue;
    }

    if (!prepared.ready) {
      pickIndex += 1;
      continue;
    }

    const deadline = isBotUserId(userId)
      ? new Date(Date.now() + BOT_PICK_DELAY_MS + 500).toISOString()
      : new Date(Date.now() + pickTimeSeconds * 1000).toISOString();

    const { error } = await supabase
      .from("league_draft_state")
      .update({
        current_pick_index: pickIndex,
        on_clock_user_id: userId,
        pick_deadline_at: deadline,
        updated_at: new Date().toISOString(),
      })
      .eq("league_id", leagueId);

    if (error) return { error: error.message };

    if (isBotUserId(userId)) {
      return runBotTurn(leagueId);
    }

    return {};
  }

  await supabase
    .from("league_draft_state")
    .update({
      status: "complete",
      on_clock_user_id: null,
      pick_deadline_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("league_id", leagueId);

  await supabase.from("leagues").update({ status: "active" }).eq("id", leagueId);

  return {};
}

export async function advanceAfterPick(
  leagueId: string,
  userId: string,
  pick: DraftPick,
  isAutoPick: boolean
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const state = await getLeagueDraftStateRow(leagueId);
  if (!state) return { error: "Live draft state not found" };

  const globalPickNumber = state.global_pick_number + 1;
  await recordDraftEvent(leagueId, userId, pick, globalPickNumber, isAutoPick);

  const nextPickIndex = state.current_pick_index + 1;
  const draftComplete = nextPickIndex >= state.total_pick_slots;

  await supabase
    .from("league_draft_state")
    .update({
      current_pick_index: nextPickIndex,
      global_pick_number: globalPickNumber,
      on_clock_user_id: null,
      pick_deadline_at: null,
      status: draftComplete ? "complete" : "in_progress",
      updated_at: new Date().toISOString(),
    })
    .eq("league_id", leagueId);

  if (draftComplete) {
    await supabase.from("leagues").update({ status: "active" }).eq("id", leagueId);

    const { data: league } = await supabase
      .from("leagues")
      .select("league_type")
      .eq("id", leagueId)
      .maybeSingle();

    if (league?.league_type === "ai") {
      const { activateAiLeagueSchedule } = await import("@/lib/league/ai-league");
      await activateAiLeagueSchedule(leagueId);
    }

    return {};
  }

  return assignOnClock(leagueId);
}

async function getStockPrice(symbol: string): Promise<number> {
  const live = await fetchFinnhubQuote(symbol);
  if (live?.price) return live.price;
  return getFallbackStockQuote(symbol)?.price ?? 0;
}

export async function pickMostExpensiveEligibleStock(
  leagueId: string,
  userId: string
): Promise<{ symbol: string; price: number } | null> {
  const state = await loadDraftStateDetailed(userId, { leagueId });
  if (!state.ok) return null;

  const { leagueOffBoard, picks, turn } = state.state;
  if (turn.type !== "open" && turn.type !== "bench") return null;
  if (turn.type === "open" && !turn.canPickStock) return null;

  const mySymbols = new Set(
    picks.filter((p) => p.pick_type !== "skip").map((p) => p.symbol.toUpperCase())
  );

  const pool = await fetchDraftPool();
  let best: { symbol: string; price: number } | null = null;

  for (const stock of pool) {
    const symbol = stock.symbol.toUpperCase();
    if (mySymbols.has(symbol)) continue;
    if (leagueOffBoard.includes(symbol)) continue;
    if (isCryptoSymbol(symbol)) continue;

    const price = await getStockPrice(symbol);
    if (!isStockPickEligible(symbol, price)) continue;

    if (!best || price > best.price || (price === best.price && symbol < best.symbol)) {
      best = { symbol, price };
    }
  }

  return best;
}

export async function resolveAutoPick(
  leagueId: string,
  userId: string
): Promise<
  | { symbol: string; price: number; reason: "safety_queue" | "highest_price" }
  | { error: string }
> {
  const supabase = await createClient();
  const state = await loadDraftStateDetailed(userId, { leagueId });
  if (!state.ok) return { error: state.error };

  const { data: draftRow } = await supabase
    .from("drafts")
    .select("safety_pick_symbol")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .maybeSingle();

  const safety = draftRow?.safety_pick_symbol?.toUpperCase();
  if (safety && !isCryptoSymbol(safety)) {
    const offBoard = state.state.leagueOffBoard.includes(safety);
    const mine = state.state.picks.some(
      (p) => p.pick_type !== "skip" && p.symbol.toUpperCase() === safety
    );
    const price = await getStockPrice(safety);
    if (!offBoard && !mine && isStockPickEligible(safety, price)) {
      return { symbol: safety, price, reason: "safety_queue" };
    }
  }

  const expensive = await pickMostExpensiveEligibleStock(leagueId, userId);
  if (!expensive) return { error: "No eligible stock available for auto-pick" };

  return { ...expensive, reason: "highest_price" };
}

export async function expirePickIfNeeded(
  leagueId: string
): Promise<{ expired?: boolean; error?: string }> {
  const state = await getLeagueDraftStateRow(leagueId);
  if (!state || state.status !== "in_progress") return {};
  if (!state.on_clock_user_id || isBotUserId(state.on_clock_user_id)) return {};
  if (!state.pick_deadline_at) return {};

  if (new Date(state.pick_deadline_at).getTime() > Date.now()) return {};

  return executeAutoPick(leagueId, state.on_clock_user_id, "timer");
}

async function executeAutoPick(
  leagueId: string,
  userId: string,
  reason: "timer"
): Promise<{ expired?: boolean; error?: string }> {
  const resolved = await resolveAutoPick(leagueId, userId);
  if ("error" in resolved) return { error: resolved.error };

  const result = await makeDraftPickForLeague(
    userId,
    leagueId,
    resolved.symbol,
    undefined,
    resolved.price,
    false,
    {
      skipLiveGate: true,
      isAutoPick: true,
      autoPickReason: resolved.reason,
    }
  );

  if (result.error) return { error: result.error };

  return { expired: true };
}

export async function runBotTurn(
  leagueId: string
): Promise<{ error?: string }> {
  const state = await getLeagueDraftStateRow(leagueId);
  if (!state || state.status !== "in_progress") return {};
  if (!state.on_clock_user_id || !isBotUserId(state.on_clock_user_id)) return {};

  const bot = BOT_BY_ID.get(state.on_clock_user_id);
  if (!bot) return { error: "Unknown bot on clock" };

  const supabase = await createClient();

  await sleep(BOT_PICK_DELAY_MS);

  const refreshed = await getLeagueDraftStateRow(leagueId);
  if (
    !refreshed ||
    refreshed.on_clock_user_id !== bot.id ||
    refreshed.status !== "in_progress"
  ) {
    return {};
  }

  const draftState = await loadDraftStateDetailed(bot.id, { leagueId });
  if (!draftState.ok) return { error: draftState.error };

  const { data: memberRow } = await supabase
    .from("league_members")
    .select("bot_personality, bot_config")
    .eq("league_id", leagueId)
    .eq("user_id", bot.id)
    .maybeSingle();

  const personality = (memberRow?.bot_personality ??
    bot.personality) as BotPersonality;
  const botConfig = (memberRow?.bot_config ?? {}) as BotConfig;

  const pool = await fetchDraftPool();
  const decision = await decideAiPick(
    personality,
    draftState.state,
    pool,
    botConfig
  );

  if (!decision) {
    return { error: `${bot.displayName} could not decide a pick` };
  }

  const result = await makeDraftPickForLeague(
    bot.id,
    leagueId,
    decision.symbol,
    decision.allocation,
    decision.price,
    decision.isSearchPick ?? false,
    { skipLiveGate: true, isAutoPick: true, autoPickReason: "bot" }
  );

  if (result.error) return { error: result.error };

  return {};
}

export async function ensureLiveDraftProgress(
  leagueId: string
): Promise<{ error?: string }> {
  const expire = await expirePickIfNeeded(leagueId);
  if (expire.error) return expire;

  const state = await getLeagueDraftStateRow(leagueId);
  if (!state || state.status !== "in_progress") return {};

  if (state.on_clock_user_id && isBotUserId(state.on_clock_user_id)) {
    if (
      !state.pick_deadline_at ||
      new Date(state.pick_deadline_at).getTime() <= Date.now()
    ) {
      return runBotTurn(leagueId);
    }
    return {};
  }

  if (!state.on_clock_user_id) {
    return assignOnClock(leagueId);
  }

  return {};
}

export async function assertOnClock(
  leagueId: string,
  userId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const live = await isLiveDraftLeague(leagueId);
  if (!live) return { ok: true };

  const state = await getLeagueDraftStateRow(leagueId);
  if (!state || state.status !== "in_progress") {
    return { ok: false, error: "Live draft is not in progress" };
  }

  if (state.on_clock_user_id !== userId) {
    return { ok: false, error: "It is not your turn to pick" };
  }

  if (
    state.pick_deadline_at &&
    new Date(state.pick_deadline_at).getTime() <= Date.now()
  ) {
    return { ok: false, error: "Pick timer expired — auto-pick in progress" };
  }

  return { ok: true };
}

export async function setSafetyPickSymbol(
  userId: string,
  leagueId: string,
  symbol: string | null
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const upper = symbol?.toUpperCase() ?? null;

  if (upper && isCryptoSymbol(upper)) {
    return { error: "Safety pick must be a stock symbol" };
  }

  const { error } = await supabase
    .from("drafts")
    .update({ safety_pick_symbol: upper })
    .eq("user_id", userId)
    .eq("league_id", leagueId);

  if (error) return { error: error.message };
  return {};
}
