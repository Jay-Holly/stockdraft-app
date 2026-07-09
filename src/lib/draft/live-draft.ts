import { loadLeagueMemberIds } from "@/lib/league/draft-order-server";
import { fetchDraftPool } from "@/lib/draft-pool/server";
import { decideAiPick } from "@/lib/draft/ai-strategy";
import {
  formatMoney,
  getMyStockSymbols,
  getSurchargePercent,
  isCryptoSymbol,
  isDraftComplete,
  draftRulesModeFromFlag,
  getMyCryptoSymbols,
  isStockPickEligible,
} from "@/lib/draft/engine";
import {
  loadDraftStateDetailed,
  makeDraftPickForLeague,
  processAllPushbackSkips,
  processPushbackSkipForLeague,
  fetchBuyerCounts,
} from "@/lib/draft/server";
import type {
  DraftFeedEvent,
  DraftPick,
  DraftState,
  LiveDraftView,
} from "@/lib/draft/types";
import { STOCK_ROUNDS } from "@/lib/draft/types";
import type { BotConfig, BotPersonality } from "@/lib/league/bots";
import { BOT_BY_ID } from "@/lib/league/bots";
import { getCryptoQuotesMap, getStockQuote } from "@/lib/roster/quotes";
import { getLeagueBotMembers } from "@/lib/league/league-bots";
import { MIN_STOCK_PRICE_USD } from "@/lib/market/draft-pool";
import {
  getFallbackStockQuote,
  listFallbackPoolSymbols,
} from "@/lib/market/fallback-quotes";
import { fetchCryptoPool } from "@/lib/crypto-pool/server";
import { isCryptoPickEligible } from "@/lib/draft/engine";
import { shouldStealthBots } from "@/lib/league/stealth-bots";
import {
  normalizeSafetyPickQueue,
  toggleSafetyPickQueueSymbol,
} from "@/lib/draft/safety-queue";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  leagueDraftUsesSnakeOrder,
  resolveUserIdForPickIndex,
} from "@/lib/draft/draft-turn-order";

export type LeagueDraftStateRow = {
  league_id: string;
  status: "waiting" | "in_progress" | "complete";
  draft_order: string[];
  current_pick_index: number;
  total_pick_slots: number;
  on_clock_user_id: string | null;
  pick_deadline_at: string | null;
  global_pick_number: number;
  /** Frozen at startLiveDraft — sports leagues only; default false for all existing drafts. */
  use_snake_order?: boolean;
  started_at: string;
  updated_at: string;
};

function draftStateUsesSnakeOrder(state: LeagueDraftStateRow): boolean {
  return state.use_snake_order === true;
}

function onClockUserIdForPickIndex(
  pickIndex: number,
  draftOrder: string[],
  state: LeagueDraftStateRow
): string | undefined {
  return resolveUserIdForPickIndex(
    pickIndex,
    draftOrder,
    draftStateUsesSnakeOrder(state)
  );
}

export type { DraftFeedEvent, LiveDraftView };

const BOT_PICK_DELAY_MS = 1500;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** PostgREST occasionally deserializes uuid[] as null — always normalize before use. */
export function normalizeDraftOrder(order: string[] | null | undefined): string[] {
  if (!Array.isArray(order)) return [];
  return order.filter((userId): userId is string => Boolean(userId));
}

export function isBotUserId(userId: string): boolean {
  return BOT_BY_ID.has(userId);
}

async function isLeagueBotUser(
  supabase: Awaited<ReturnType<typeof createClient>>,
  leagueId: string,
  userId: string
): Promise<boolean> {
  if (BOT_BY_ID.has(userId)) return true;

  const { data } = await supabase
    .from("league_members")
    .select("bot_personality")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .maybeSingle();

  return Boolean(data?.bot_personality);
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
    return `Round ${roundNumber} — ${teamName}: Round skipped (crypto pushback)`;
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
  const { data } = await supabase
    .from("league_members")
    .select("display_name")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .maybeSingle();

  if (data?.display_name) return data.display_name;

  const bot = BOT_BY_ID.get(userId);
  if (bot) return bot.displayName;

  const { data: profile } = await supabase
    .from("profiles")
    .select("team_name")
    .eq("id", userId)
    .maybeSingle();

  return profile?.team_name ?? "Unknown Team";
}

export async function getLeagueDraftStateRow(
  leagueId: string,
  supabaseOverride?: SupabaseClient
): Promise<LeagueDraftStateRow | null> {
  const supabase = supabaseOverride ?? (await createClient());
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

  const draftOrderIds = normalizeDraftOrder(state.draft_order);
  if (draftOrderIds.length === 0) return null;

  const supabase = await createClient();
  const { data: leagueMeta } = await supabase
    .from("leagues")
    .select("league_type, visibility, opponent_type")
    .eq("id", leagueId)
    .maybeSingle();

  const stealthBots =
    leagueMeta &&
    shouldStealthBots({
      leagueType: leagueMeta.league_type,
      visibility: leagueMeta.visibility as "private" | "public",
      opponentType: leagueMeta.opponent_type as "all_ai" | "all_human" | "mixed",
    });

  const draftOrder = await Promise.all(
    draftOrderIds.map(async (userId) => ({
      userId,
      teamName: await getTeamName(supabase, leagueId, userId),
      isBot: stealthBots
        ? false
        : await isLeagueBotUser(supabase, leagueId, userId),
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

async function repairHumanLiveDraftOrderIfNeeded(leagueId: string): Promise<void> {
  const supabase = await createClient();
  const { data: league } = await supabase
    .from("leagues")
    .select("league_type, status")
    .eq("id", leagueId)
    .maybeSingle();

  if (league?.league_type !== "human") return;

  const state = await getLeagueDraftStateRow(leagueId);
  if (!state || state.status !== "in_progress") return;

  const memberIds = await loadLeagueMemberIds(leagueId);
  if (memberIds.length < 2) return;

  const memberSet = new Set(memberIds);
  const order = normalizeDraftOrder(state.draft_order);
  const staleInOrder = order.filter((id) => !memberSet.has(id));
  const missingFromOrder = memberIds.filter((id) => !order.includes(id));

  if (staleInOrder.length === 0 && missingFromOrder.length === 0) {
    if (league.status === "waiting") {
      await supabase
        .from("leagues")
        .update({ status: "drafting" })
        .eq("id", leagueId)
        .eq("status", "waiting");
    }
    return;
  }

  const missingQueue = [...missingFromOrder];
  const newOrder = [...order];

  for (let i = 0; i < newOrder.length; i++) {
    if (!memberSet.has(newOrder[i])) {
      const replacement = missingQueue.shift();
      if (replacement) {
        newOrder[i] = replacement;
      } else {
        newOrder.splice(i, 1);
        i -= 1;
      }
    }
  }

  for (const memberId of missingQueue) {
    if (!newOrder.includes(memberId)) {
      newOrder.push(memberId);
    }
  }

  const totalPickSlots = newOrder.length * 15;

  await supabase
    .from("league_draft_state")
    .update({
      draft_order: newOrder,
      total_pick_slots: totalPickSlots,
      updated_at: new Date().toISOString(),
    })
    .eq("league_id", leagueId);

  for (let slot = 0; slot < newOrder.length; slot++) {
    await supabase
      .from("league_members")
      .update({ draft_slot: slot })
      .eq("league_id", leagueId)
      .eq("user_id", newOrder[slot]);
  }

  if (league.status === "waiting") {
    await supabase
      .from("leagues")
      .update({ status: "drafting" })
      .eq("id", leagueId)
      .eq("status", "waiting");
  }

  if (state.on_clock_user_id && !memberSet.has(state.on_clock_user_id)) {
    await supabase
      .from("league_draft_state")
      .update({
        on_clock_user_id: null,
        pick_deadline_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("league_id", leagueId);
  }
}

async function repairLiveDraftOrderIfNeeded(leagueId: string): Promise<void> {
  await repairHumanLiveDraftOrderIfNeeded(leagueId);

  const state = await getLeagueDraftStateRow(leagueId);
  if (!state || state.status !== "in_progress") return;

  const order = normalizeDraftOrder(state.draft_order);
  const leagueBots = await getLeagueBotMembers(leagueId);
  if (leagueBots.length === 0) return;

  const botIds = leagueBots.map((b) => b.id);
  const hasAllBots =
    botIds.every((id) => order.includes(id)) &&
    order.length === 1 + botIds.length;

  if (hasAllBots) return;

  const humanId =
    order.find((id) => !isBotUserId(id)) ?? order[0] ?? null;
  if (!humanId) return;

  const draftOrder = [humanId, ...botIds];
  const totalPickSlots = draftOrder.length * 15;

  const supabase = await createClient();
  await supabase
    .from("league_draft_state")
    .update({
      draft_order: draftOrder,
      total_pick_slots: totalPickSlots,
      updated_at: new Date().toISOString(),
    })
    .eq("league_id", leagueId);
}

export async function startLiveDraft(
  leagueId: string,
  humanUserId: string,
  pickTimeSeconds = 120,
  options?: { draftOrder?: string[]; supabase?: SupabaseClient }
): Promise<{ error?: string }> {
  const supabase = options?.supabase ?? (await createClient());

  const resolvedOrder = normalizeDraftOrder(
    options?.draftOrder ??
      [humanUserId, ...(await getLeagueBotMembers(leagueId)).map((b) => b.id)]
  );

  if (resolvedOrder.length < 2) {
    return { error: "Not enough teams to start the live draft." };
  }

  const existing = await getLeagueDraftStateRow(leagueId, supabase);
  const existingOrder = normalizeDraftOrder(existing?.draft_order);
  if (
    existing &&
    existingOrder.length >= 2 &&
    existing.status !== "complete"
  ) {
    if (!existing.on_clock_user_id && existing.status === "in_progress") {
      return assignOnClock(leagueId, supabase);
    }
    return {};
  }

  const totalPickSlots = resolvedOrder.length * 15;

  for (let i = 0; i < resolvedOrder.length; i++) {
    await supabase
      .from("league_members")
      .update({ draft_slot: i })
      .eq("league_id", leagueId)
      .eq("user_id", resolvedOrder[i]);
  }

  await supabase
    .from("leagues")
    .update({ draft_format: "live", pick_time_seconds: pickTimeSeconds })
    .eq("id", leagueId);

  const { data: leagueMeta } = await supabase
    .from("leagues")
    .select("format_type")
    .eq("id", leagueId)
    .maybeSingle();

  const useSnakeOrder = leagueDraftUsesSnakeOrder(leagueMeta?.format_type);

  const { error } = await supabase.from("league_draft_state").insert({
    league_id: leagueId,
    status: "in_progress",
    draft_order: resolvedOrder,
    current_pick_index: 0,
    total_pick_slots: totalPickSlots,
    global_pick_number: 0,
    use_snake_order: useSnakeOrder,
  });

  if (error) {
    const isDuplicate =
      error.code === "23505" ||
      error.message.toLowerCase().includes("duplicate key");
    if (isDuplicate) {
      const repaired = await getLeagueDraftStateRow(leagueId, supabase);
      if (normalizeDraftOrder(repaired?.draft_order).length >= 2) {
        if (!repaired?.on_clock_user_id && repaired?.status === "in_progress") {
          return assignOnClock(leagueId, supabase);
        }
        return {};
      }
    }
    return { error: error.message };
  }

  return assignOnClock(leagueId, supabase);
}

async function recordDraftEvent(
  leagueId: string,
  userId: string,
  pick: DraftPick,
  globalPickNumber: number,
  isAutoPick: boolean
): Promise<DraftFeedEvent | null> {
  const supabase = await createClient();
  const teamName = await getTeamName(supabase, leagueId, userId);
  const message = formatDraftEventMessage(teamName, pick.round_number, pick);

  const { data: event, error: eventError } = await supabase
    .from("league_draft_events")
    .insert({
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
    })
    .select("*")
    .single();

  if (eventError || !event) return null;

  await supabase
    .from("draft_picks")
    .update({
      global_pick_number: globalPickNumber,
      is_auto_pick: isAutoPick,
    })
    .eq("id", pick.id);

  try {
    const { data: draftRow } = await supabase
      .from("drafts")
      .select("pushback_skips_remaining")
      .eq("league_id", leagueId)
      .eq("user_id", userId)
      .maybeSingle();

    const { postBotReactionsForDraftEvent } = await import("@/lib/draft/chat");
    await postBotReactionsForDraftEvent(
      leagueId,
      event as DraftFeedEvent,
      {
        pushbackSkipsRemaining: draftRow?.pushback_skips_remaining,
      }
    );
  } catch {
    // Chat reactions are best-effort — never block the draft.
  }

  return event as DraftFeedEvent;
}

async function isUserDraftComplete(
  leagueId: string,
  userId: string
): Promise<boolean> {
  const state = await loadDraftStateDetailed(userId, { leagueId });
  if (!state.ok) return true;
  if (state.state.draft.status === "complete") return true;
  const rules = draftRulesModeFromFlag(state.state.sportsSimDraftRules);
  return isDraftComplete(state.state.picks, rules);
}

async function allTeamsDraftComplete(
  leagueId: string,
  draftOrder: string[]
): Promise<boolean> {
  for (const userId of draftOrder) {
    if (!(await isUserDraftComplete(leagueId, userId))) {
      return false;
    }
  }
  return true;
}

async function extendLiveDraftSlotsIfNeeded(
  leagueId: string,
  pickIndex: number,
  totalPickSlots: number,
  draftOrder: string[]
): Promise<number> {
  let total = totalPickSlots;
  while (
    pickIndex >= total &&
    !(await allTeamsDraftComplete(leagueId, draftOrder))
  ) {
    total += draftOrder.length;
  }

  if (total > totalPickSlots) {
    const supabase = await createClient();
    await supabase
      .from("league_draft_state")
      .update({
        total_pick_slots: total,
        updated_at: new Date().toISOString(),
      })
      .eq("league_id", leagueId);
  }

  return total;
}

async function prepareTeamOnClock(
  leagueId: string,
  userId: string,
  depth = 0
): Promise<{
  ready: boolean;
  complete: boolean;
  liveSkipAdvanced?: boolean;
  error?: string;
}> {
  if (depth > 15) {
    return { ready: false, complete: false, error: "Too many pushback skips" };
  }

  const live = await isLiveDraftLeague(leagueId);

  if (live) {
    const state = await loadDraftStateDetailed(userId, { leagueId });
    if (!state.ok) return { ready: false, complete: false, error: state.error };

    if (
      state.state.draft.status === "complete" ||
      isDraftComplete(
        state.state.picks,
        draftRulesModeFromFlag(state.state.sportsSimDraftRules)
      )
    ) {
      return { ready: false, complete: true };
    }

    if (
      !state.state.sportsSimDraftRules &&
      state.state.turn.type === "pushback_skip"
    ) {
      const skipResult = await processPushbackSkipForLeague(userId, leagueId, {
        advanceLiveDraft: true,
      });
      if (skipResult.error) {
        return { ready: false, complete: false, error: skipResult.error };
      }
      if (skipResult.liveAdvanced) {
        return { ready: false, complete: false, liveSkipAdvanced: true };
      }
    }

    return { ready: true, complete: false };
  }

  const skipResult = await processAllPushbackSkips(userId, { leagueId });
  if (skipResult.error) return { ready: false, complete: false, error: skipResult.error };

  const state = await loadDraftStateDetailed(userId, { leagueId });
  if (!state.ok) return { ready: false, complete: false, error: state.error };

  if (
    state.state.draft.status === "complete" ||
    isDraftComplete(
      state.state.picks,
      draftRulesModeFromFlag(state.state.sportsSimDraftRules)
    )
  ) {
    return { ready: false, complete: true };
  }

  if (
    !state.state.sportsSimDraftRules &&
    state.state.turn.type === "pushback_skip"
  ) {
    return prepareTeamOnClock(leagueId, userId, depth + 1);
  }

  return { ready: true, complete: false };
}

export function getExpectedOnClockUserId(
  state: LeagueDraftStateRow
): string | null {
  const draftOrder = normalizeDraftOrder(state.draft_order);
  if (state.status !== "in_progress") return null;
  if (state.current_pick_index >= state.total_pick_slots) return null;
  if (draftOrder.length === 0) return null;
  return onClockUserIdForPickIndex(
    state.current_pick_index,
    draftOrder,
    state
  ) ?? null;
}

type OnClockPeek = "complete" | "ready" | "pushback_skip" | "unavailable";

async function peekTeamOnClockStatus(
  leagueId: string,
  userId: string
): Promise<OnClockPeek> {
  const state = await loadDraftStateDetailed(userId, { leagueId });
  if (!state.ok) return "unavailable";

  if (
    state.state.draft.status === "complete" ||
    isDraftComplete(
      state.state.picks,
      draftRulesModeFromFlag(state.state.sportsSimDraftRules)
    )
  ) {
    return "complete";
  }

  if (
    !state.state.sportsSimDraftRules &&
    state.state.turn.type === "pushback_skip"
  ) {
    return "pushback_skip";
  }

  return "ready";
}

/** Read-only mirror of assignOnClock's slot walk (skips finished teams). */
async function peekNextOnClockUserId(
  leagueId: string,
  state: LeagueDraftStateRow
): Promise<string | null> {
  const draftOrder = normalizeDraftOrder(state.draft_order);
  if (state.status !== "in_progress") return null;
  if (state.current_pick_index >= state.total_pick_slots) return null;
  if (draftOrder.length === 0) return null;

  let pickIndex = state.current_pick_index;
  while (pickIndex < state.total_pick_slots) {
    const userId = onClockUserIdForPickIndex(pickIndex, draftOrder, state);
    if (!userId) {
      pickIndex += 1;
      continue;
    }
    const status = await peekTeamOnClockStatus(leagueId, userId);
    if (status === "complete" || status === "unavailable") {
      pickIndex += 1;
      continue;
    }
    return userId;
  }
  return null;
}

export async function repairLiveDraftClock(
  leagueId: string
): Promise<{ repaired?: boolean; error?: string }> {
  const state = await getLeagueDraftStateRow(leagueId);
  if (!state || state.status !== "in_progress") return {};

  const feed = await getDraftFeed(leagueId);
  const maxFeedGlobal =
    feed.length > 0
      ? Math.max(...feed.map((event) => event.global_pick_number))
      : 0;

  if (maxFeedGlobal > state.global_pick_number) {
    const supabase = await createClient();

    // Never steal the clock from an active human mid-pick to reconcile feed drift.
    if (
      state.on_clock_user_id &&
      !(await isLeagueBotUser(supabase, leagueId, state.on_clock_user_id))
    ) {
      const deadlineOk =
        !state.pick_deadline_at ||
        new Date(state.pick_deadline_at).getTime() > Date.now();
      if (deadlineOk) {
        const status = await peekTeamOnClockStatus(
          leagueId,
          state.on_clock_user_id
        );
        if (status === "ready" || status === "pushback_skip") {
          console.warn(
            `repairLiveDraftClock: feed global ${maxFeedGlobal} ahead of state ${state.global_pick_number}, but ${state.on_clock_user_id} still on clock with turn ${status} — syncing counter only`
          );
          await supabase
            .from("league_draft_state")
            .update({
              global_pick_number: maxFeedGlobal,
              updated_at: new Date().toISOString(),
            })
            .eq("league_id", leagueId);
          return {};
        }
      }
    }

    const syncedIndex = Math.min(maxFeedGlobal, state.total_pick_slots);
    const draftOrder = normalizeDraftOrder(state.draft_order);
    const draftComplete = await allTeamsDraftComplete(leagueId, draftOrder);

    const { error } = await supabase
      .from("league_draft_state")
      .update({
        global_pick_number: syncedIndex,
        current_pick_index: syncedIndex,
        on_clock_user_id: null,
        pick_deadline_at: null,
        status: draftComplete ? "complete" : "in_progress",
        updated_at: new Date().toISOString(),
      })
      .eq("league_id", leagueId);

    if (error) return { error: error.message };

    if (draftComplete) {
      await supabase.from("leagues").update({ status: "active" }).eq("id", leagueId);
      await maybeFinalizeHumanLeagueAfterDraft(supabase, leagueId);
      return { repaired: true };
    }

    const assign = await assignOnClock(leagueId);
    return assign.error ? { error: assign.error } : { repaired: true };
  }

  const expected = await peekNextOnClockUserId(leagueId, state);
  if (!expected) {
    const assign = await assignOnClock(leagueId);
    return assign.error ? { error: assign.error } : { repaired: true };
  }

  if (!state.on_clock_user_id || state.on_clock_user_id !== expected) {
    const assign = await assignOnClock(leagueId);
    return assign.error ? { error: assign.error } : { repaired: true };
  }

  return {};
}

export async function assignOnClock(
  leagueId: string,
  supabaseOverride?: SupabaseClient
): Promise<{ error?: string }> {
  const supabase = supabaseOverride ?? (await createClient());
  const state = await getLeagueDraftStateRow(leagueId, supabase);
  if (!state || state.status === "complete") return {};

  const draftOrder = normalizeDraftOrder(state.draft_order);
  if (draftOrder.length === 0) {
    return { error: "Live draft order is not ready yet." };
  }

  const { data: league } = await supabase
    .from("leagues")
    .select("pick_time_seconds")
    .eq("id", leagueId)
    .single();

  const pickTimeSeconds = league?.pick_time_seconds ?? 120;
  let pickIndex = state.current_pick_index;
  let totalPickSlots = state.total_pick_slots;
  const skipPrepare =
    Boolean(supabaseOverride) &&
    state.current_pick_index === 0 &&
    state.global_pick_number === 0;

  while (true) {
    if (pickIndex >= totalPickSlots) {
      totalPickSlots = await extendLiveDraftSlotsIfNeeded(
        leagueId,
        pickIndex,
        totalPickSlots,
        draftOrder
      );
      if (pickIndex >= totalPickSlots) {
        break;
      }
    }

    const userId = onClockUserIdForPickIndex(pickIndex, draftOrder, state);
    if (!userId) {
      pickIndex += 1;
      continue;
    }

    const { data: memberRow } = await supabase
      .from("league_members")
      .select("user_id")
      .eq("league_id", leagueId)
      .eq("user_id", userId)
      .maybeSingle();

    if (!memberRow) {
      pickIndex += 1;
      continue;
    }

    const prepared = skipPrepare
      ? { ready: true, complete: false }
      : await prepareTeamOnClock(leagueId, userId);
    if (prepared.error) return { error: prepared.error };

    if (prepared.liveSkipAdvanced) {
      return {};
    }

    if (prepared.complete) {
      pickIndex += 1;
      continue;
    }

    if (!prepared.ready) {
      return { error: `Could not prepare draft turn for ${userId}` };
    }

    const deadline = (await isLeagueBotUser(supabase, leagueId, userId))
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

    return {};
  }

  const allComplete = await allTeamsDraftComplete(leagueId, draftOrder);
  if (!allComplete) {
    return {
      error:
        "Live draft slots exhausted before all teams finished — retry assignOnClock",
    };
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
  await maybeFinalizeHumanLeagueAfterDraft(supabase, leagueId);

  return {};
}

async function maybeFinalizeHumanLeagueAfterDraft(
  supabase: Awaited<ReturnType<typeof createClient>>,
  leagueId: string
): Promise<void> {
  const { data: league } = await supabase
    .from("leagues")
    .select("league_type, owner_user_id")
    .eq("id", leagueId)
    .maybeSingle();

  if (league?.league_type !== "human" || !league.owner_user_id) return;

  const { finalizeHumanLeagueAfterDraft } = await import(
    "@/lib/matchup/seed-human-schedule"
  );
  const result = await finalizeHumanLeagueAfterDraft(
    leagueId,
    league.owner_user_id
  );
  if (result.error) {
    console.error(
      `[maybeFinalizeHumanLeagueAfterDraft] league=${leagueId}:`,
      result.error
    );
  }
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
  const nextPickIndex = state.current_pick_index + 1;
  const draftOrder = normalizeDraftOrder(state.draft_order);
  let totalPickSlots = state.total_pick_slots;

  if (nextPickIndex >= totalPickSlots && draftOrder.length > 0) {
    totalPickSlots = await extendLiveDraftSlotsIfNeeded(
      leagueId,
      nextPickIndex,
      totalPickSlots,
      draftOrder
    );
  }

  const allComplete = await allTeamsDraftComplete(leagueId, draftOrder);
  const draftComplete = allComplete;

  // Advance league state before writing the feed event so a failed DB update
  // cannot leave the feed ahead of league_draft_state (which steals the clock on repair).
  const { error: stateError } = await supabase
    .from("league_draft_state")
    .update({
      current_pick_index: nextPickIndex,
      global_pick_number: globalPickNumber,
      on_clock_user_id: null,
      pick_deadline_at: null,
      status: draftComplete ? "complete" : "in_progress",
      total_pick_slots: totalPickSlots,
      updated_at: new Date().toISOString(),
    })
    .eq("league_id", leagueId);

  if (stateError) return { error: stateError.message };

  await recordDraftEvent(leagueId, userId, pick, globalPickNumber, isAutoPick);

  if (draftComplete) {
    await supabase.from("leagues").update({ status: "active" }).eq("id", leagueId);

    const { data: league } = await supabase
      .from("leagues")
      .select("league_type")
      .eq("id", leagueId)
      .maybeSingle();

    if (league?.league_type === "ai") {
      const { activateAiLeagueSchedule } = await import("@/lib/league/ai-league");
      await activateAiLeagueSchedule(leagueId, userId);
    } else if (league?.league_type === "human") {
      const { activateHumanLeagueScheduleWithMatchups } = await import(
        "@/lib/league/draft-scheduler"
      );
      const { data: ownerRow } = await supabase
        .from("leagues")
        .select("owner_user_id")
        .eq("id", leagueId)
        .maybeSingle();
      if (ownerRow?.owner_user_id) {
        const result = await activateHumanLeagueScheduleWithMatchups(
          leagueId,
          ownerRow.owner_user_id
        );
        if (result.error) {
          console.error(
            `[advanceAfterPick] matchup seed failed league=${leagueId}:`,
            result.error
          );
        }
      } else {
        const { activateHumanLeagueSchedule } = await import(
          "@/lib/league/human-league"
        );
        await activateHumanLeagueSchedule(leagueId);
      }
    }

    return {};
  }

  return assignOnClock(leagueId);
}

async function getStockPrice(symbol: string): Promise<number> {
  const { price } = await getStockQuote(symbol);
  if (price > 0) return price;
  return getFallbackStockQuote(symbol)?.price ?? 0;
}

type AutoPickStockTier = "strict" | "relaxed" | "desperate";

type AutoPickResolution =
  | {
      symbol: string;
      price: number;
      allocation?: number;
      reason: "safety_queue" | "highest_price" | "timer";
    }
  | { kind: "pushback_skip" };

function isAutoPickPick(
  resolved: AutoPickResolution | { error: string }
): resolved is Extract<AutoPickResolution, { symbol: string }> {
  return "symbol" in resolved;
}

async function loadAutoPickPoolSymbols(): Promise<string[]> {
  const pool = await fetchDraftPool();
  if (pool.length > 0) {
    return pool.map((stock) => stock.symbol.toUpperCase());
  }
  return listFallbackPoolSymbols();
}

function pickBestStockCandidate(
  symbols: string[],
  mySymbols: Set<string>,
  offBoard: Set<string>,
  tier: AutoPickStockTier
): { symbol: string; price: number } | null {
  let best: { symbol: string; price: number } | null = null;

  for (const rawSymbol of symbols) {
    const symbol = rawSymbol.toUpperCase();
    if (mySymbols.has(symbol)) continue;
    if (offBoard.has(symbol)) continue;
    if (isCryptoSymbol(symbol)) continue;

    const fallback = getFallbackStockQuote(symbol);
    let price = fallback?.price ?? 0;

    if (tier === "strict") {
      if (!isStockPickEligible(symbol, price)) continue;
    } else {
      if (price <= 0) continue;
      price = Math.max(price, MIN_STOCK_PRICE_USD);
    }

    if (
      !best ||
      price > best.price ||
      (price === best.price && symbol < best.symbol)
    ) {
      best = { symbol, price };
    }
  }

  return best;
}

async function scanAutoPickStock(
  leagueId: string,
  userId: string,
  tier: AutoPickStockTier
): Promise<{ symbol: string; price: number } | null> {
  const state = await loadDraftStateDetailed(userId, { leagueId });
  if (!state.ok) return null;

  const { leagueOffBoard, picks, turn } = state.state;
  if (turn.type !== "open" && turn.type !== "bench") return null;
  if (turn.type === "open" && !turn.canPickStock) return null;

  const mySymbols = getMyStockSymbols(picks);
  const offBoard = new Set(leagueOffBoard.map((symbol) => symbol.toUpperCase()));
  const symbols = await loadAutoPickPoolSymbols();
  const best = pickBestStockCandidate(symbols, mySymbols, offBoard, tier);
  if (!best) return null;

  if (tier === "desperate") {
    return best;
  }

  const { price: cachedPrice } = await getStockQuote(best.symbol);
  if (cachedPrice > 0) {
    const livePrice =
      tier === "relaxed"
        ? Math.max(cachedPrice, MIN_STOCK_PRICE_USD)
        : cachedPrice;
    if (tier === "relaxed" || isStockPickEligible(best.symbol, livePrice)) {
      return { symbol: best.symbol, price: livePrice };
    }
  }

  return best;
}

export async function pickMostExpensiveEligibleStock(
  leagueId: string,
  userId: string
): Promise<{ symbol: string; price: number } | null> {
  return scanAutoPickStock(leagueId, userId, "strict");
}

async function resolveAutoCryptoPick(
  leagueId: string,
  userId: string,
  state: Pick<DraftState, "summary" | "picks" | "sportsSimDraftRules">
): Promise<{ symbol: string; price: number; allocation?: number } | null> {
  const { summary, picks, sportsSimDraftRules } = state;

  if (sportsSimDraftRules) {
    if (summary.stockPicks + summary.cryptoPicks >= STOCK_ROUNDS) return null;
  } else if (summary.cryptoRemaining <= 0) {
    return null;
  }

  let quotes: Awaited<ReturnType<typeof getCryptoQuotesMap>> | null = null;
  try {
    quotes = await getCryptoQuotesMap();
  } catch (err) {
    console.error("resolveAutoCryptoPick getCryptoQuotesMap failed:", err);
  }

  const pool = await fetchCryptoPool();
  const symbols =
    pool.length > 0
      ? pool
      : ["BTC", "ETH", "SOL", "DOGE"].map((symbol, index) => ({
          symbol,
          name: symbol,
          coingeckoId: symbol.toLowerCase(),
          marketCapRank: index + 1,
          referencePriceUsd: null,
        }));

  const supabase = await createClient();
  const buyerCounts = sportsSimDraftRules
    ? {}
    : await fetchBuyerCounts(supabase, leagueId);
  const myDraftedCrypto = getMyCryptoSymbols(picks);

  type Candidate = { symbol: string; price: number; marketCapRank: number };
  const eligible: Candidate[] = [];

  for (const coin of symbols) {
    const symbol = coin.symbol.toUpperCase();
    const price = quotes?.[symbol]?.price ?? coin.referencePriceUsd ?? 0;
    if (price <= 0 || !isCryptoPickEligible(symbol, price)) continue;

    if (!sportsSimDraftRules) {
      const leagueBuyers = buyerCounts[symbol] ?? 0;
      const surcharge = getSurchargePercent(leagueBuyers);
      if (surcharge >= 80) continue;
    }

    eligible.push({
      symbol,
      price,
      marketCapRank: coin.marketCapRank ?? 9999,
    });
  }

  const undrafted = eligible.filter((c) => !myDraftedCrypto.has(c.symbol));
  const candidatePool =
    sportsSimDraftRules || undrafted.length > 0 ? undrafted : eligible;
  if (candidatePool.length === 0) return null;

  let best: Candidate | null = null;
  for (const candidate of candidatePool) {
    if (
      !best ||
      candidate.price > best.price ||
      (candidate.price === best.price &&
        candidate.marketCapRank < best.marketCapRank)
    ) {
      best = candidate;
    }
  }

  if (!best) return null;

  return {
    symbol: best.symbol,
    price: best.price,
    allocation: sportsSimDraftRules ? undefined : summary.cryptoRemaining,
  };
}

async function trySafetyStockAutoPick(
  leagueId: string,
  userId: string
): Promise<{ symbol: string; price: number; reason: "safety_queue" } | null> {
  const supabase = await createClient();
  const state = await loadDraftStateDetailed(userId, { leagueId });
  if (!state.ok) return null;

  const { data: draftRow } = await supabase
    .from("drafts")
    .select("safety_pick_queue, safety_pick_symbol")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .maybeSingle();

  const queue = normalizeSafetyPickQueue(
    draftRow?.safety_pick_queue,
    draftRow?.safety_pick_symbol
  );

  for (const safety of queue) {
    if (isCryptoSymbol(safety)) continue;

    const offBoard = state.state.leagueOffBoard.includes(safety);
    const mine = getMyStockSymbols(state.state.picks).has(safety);
    const fallbackPrice = getFallbackStockQuote(safety)?.price ?? 0;
    const price = (await getStockPrice(safety)) || fallbackPrice;
    if (!offBoard && !mine && isStockPickEligible(safety, price)) {
      return { symbol: safety, price, reason: "safety_queue" };
    }
  }

  return null;
}

export async function resolveAutoPick(
  leagueId: string,
  userId: string
): Promise<AutoPickResolution | { error: string }> {
  const state = await loadDraftStateDetailed(userId, { leagueId });
  if (!state.ok) return { error: state.error };

  const { turn, summary } = state.state;

  if (!state.state.sportsSimDraftRules && turn.type === "pushback_skip") {
    return { kind: "pushback_skip" };
  }

  if (turn.type === "complete") {
    return { error: "Draft is already complete" };
  }

  const safety = await trySafetyStockAutoPick(leagueId, userId);
  if (safety && turn.type !== "crypto") return safety;

  if (
    turn.type === "crypto" ||
    (turn.canPickCrypto && !turn.canPickStock) ||
    (state.state.sportsSimDraftRules &&
      turn.type === "open" &&
      turn.canPickCrypto &&
      summary.cryptoPicks < summary.stockPicks)
  ) {
    const crypto = await resolveAutoCryptoPick(leagueId, userId, state.state);
    if (crypto) {
      return { ...crypto, reason: "timer" };
    }
  }

  if (turn.type === "bench" || (turn.type === "open" && turn.canPickStock)) {
    for (const tier of ["strict", "relaxed", "desperate"] as const) {
      const stock = await scanAutoPickStock(leagueId, userId, tier);
      if (stock) {
        return { ...stock, reason: "highest_price" };
      }
    }
  }

  if (turn.canPickCrypto && summary.cryptoRemaining > 0) {
    const crypto = await resolveAutoCryptoPick(leagueId, userId, state.state);
    if (crypto) {
      return { ...crypto, reason: "timer" };
    }
  }

  return { error: "No eligible pick available for auto-pick" };
}

export async function expirePickIfNeeded(
  leagueId: string
): Promise<{ expired?: boolean; error?: string }> {
  const state = await getLeagueDraftStateRow(leagueId);
  if (!state || state.status !== "in_progress") return {};
  if (!state.on_clock_user_id) return {};

  const supabase = await createClient();
  if (await isLeagueBotUser(supabase, leagueId, state.on_clock_user_id)) {
    return {};
  }
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

  if ("kind" in resolved && resolved.kind === "pushback_skip") {
    const skip = await processPushbackSkipForLeague(userId, leagueId, {
      advanceLiveDraft: true,
    });
    if (skip.error) {
      await extendPickDeadlineForUser(leagueId, userId);
      console.error(
        `Auto-pick pushback skip failed league=${leagueId} user=${userId}: ${skip.error}`
      );
      return {};
    }
    return { expired: true };
  }

  if ("error" in resolved) {
    await extendPickDeadlineForUser(leagueId, userId);
    console.error(
      `Auto-pick unresolved league=${leagueId} user=${userId}: ${resolved.error}`
    );
    return {};
  }

  if (!isAutoPickPick(resolved)) {
    return { expired: true };
  }

  const result = await makeDraftPickForLeague(
    userId,
    leagueId,
    resolved.symbol,
    resolved.allocation,
    resolved.price,
    false,
    {
      skipLiveGate: true,
      isAutoPick: true,
      autoPickReason: resolved.reason,
    }
  );

  if (result.error) {
    await extendPickDeadlineForUser(leagueId, userId);
    console.error(
      `Auto-pick insert failed league=${leagueId} user=${userId} symbol=${resolved.symbol}: ${result.error}`
    );
    return {};
  }

  return { expired: true };
}

export async function runBotTurn(
  leagueId: string,
  options?: { skipDelay?: boolean; fastPick?: boolean }
): Promise<{ error?: string }> {
  const state = await getLeagueDraftStateRow(leagueId);
  if (!state || state.status !== "in_progress") return {};
  if (!state.on_clock_user_id) return {};

  const supabase = await createClient();
  const botUserId = state.on_clock_user_id;
  if (!(await isLeagueBotUser(supabase, leagueId, botUserId))) return {};

  const botProfile = BOT_BY_ID.get(botUserId);
  const botName = await getTeamName(supabase, leagueId, botUserId);

  if (!options?.skipDelay) {
    await sleep(BOT_PICK_DELAY_MS);
  }

  const refreshed = await getLeagueDraftStateRow(leagueId);
  if (
    !refreshed ||
    refreshed.on_clock_user_id !== botUserId ||
    refreshed.status !== "in_progress"
  ) {
    return {};
  }

  const draftState = await loadDraftStateDetailed(botUserId, { leagueId });
  if (!draftState.ok) return { error: draftState.error };

  const { data: memberRow } = await supabase
    .from("league_members")
    .select("bot_personality, bot_config")
    .eq("league_id", leagueId)
    .eq("user_id", botUserId)
    .maybeSingle();

  if (!memberRow?.bot_personality && !botProfile) {
    return { error: "Unknown manager on clock" };
  }

  const personality = (memberRow?.bot_personality ??
    botProfile?.personality) as BotPersonality;
  const botConfig = (memberRow?.bot_config ?? {}) as BotConfig;

  const pool = await fetchDraftPool();
  let decision: Awaited<ReturnType<typeof decideAiPick>>;
  try {
    decision = await decideAiPick(
      personality,
      draftState.state,
      pool,
      botConfig,
      { fast: options?.fastPick ?? false }
    );
  } catch (err) {
    console.error(`${botName} decideAiPick threw:`, err);
    decision = null;
  }

  if (!decision) {
    const fallback = await resolveAutoPick(leagueId, botUserId);
    if ("kind" in fallback && fallback.kind === "pushback_skip") {
      const skip = await processPushbackSkipForLeague(botUserId, leagueId, {
        advanceLiveDraft: true,
      });
      if (!skip.error) return {};
    } else if (isAutoPickPick(fallback)) {
      const fallbackResult = await makeDraftPickForLeague(
        botUserId,
        leagueId,
        fallback.symbol,
        fallback.allocation,
        fallback.price,
        false,
        { skipLiveGate: true, isAutoPick: true, autoPickReason: "bot" }
      );
      if (!fallbackResult.error) return {};
    }
    return { error: `${botName} could not decide a pick` };
  }

  const result = await makeDraftPickForLeague(
    botUserId,
    leagueId,
    decision.symbol,
    decision.allocation,
    decision.price,
    decision.isSearchPick ?? false,
    { skipLiveGate: true, isAutoPick: false, autoPickReason: "bot" }
  );

  if (result.error) {
    await repairLiveDraftClock(leagueId);
    return { error: result.error };
  }

  return {};
}

async function logLiveDraftProgressError(
  leagueId: string,
  step: string,
  message: string
): Promise<void> {
  console.error(`ensureLiveDraftProgress [${step}] league=${leagueId}: ${message}`);

  const clock = await getLeagueDraftStateRow(leagueId);
  if (!clock?.on_clock_user_id) return;

  const onClockState = await loadDraftStateDetailed(clock.on_clock_user_id, {
    leagueId,
  });
  if (!onClockState.ok) {
    console.error(
      `  on-clock user=${clock.on_clock_user_id} state load failed: ${onClockState.error}`
    );
    return;
  }

  const { draft, turn, summary } = onClockState.state;
  console.error(
    `  on-clock user=${clock.on_clock_user_id} turn=${turn.type} round=${draft.current_round} stockPicks=${summary.stockPicks} benchPicks=${summary.benchPicks} cryptoRemaining=${summary.cryptoRemaining} pushbackSkips=${draft.pushback_skips_remaining}`
  );
}

export async function ensureLiveDraftProgress(
  leagueId: string,
  options?: { interactive?: boolean }
): Promise<{ error?: string }> {
  const interactive = options?.interactive ?? true;
  const botWorkBudgetMs = interactive ? 25_000 : 10_000;

  await repairLiveDraftOrderIfNeeded(leagueId);

  const repair = await repairLiveDraftClock(leagueId);
  if (repair.error) {
    await logLiveDraftProgressError(leagueId, "repairLiveDraftClock", repair.error);
    return repair;
  }

  const expire = await expirePickIfNeeded(leagueId);
  if (expire.error) {
    await logLiveDraftProgressError(leagueId, "expirePickIfNeeded", expire.error);
    return expire;
  }

  let state = await getLeagueDraftStateRow(leagueId);
  if (!state || state.status !== "in_progress") return {};

  const supabase = await createClient();
  if (
    state.on_clock_user_id &&
    (await isLeagueBotUser(supabase, leagueId, state.on_clock_user_id))
  ) {
    if (
      !state.pick_deadline_at ||
      new Date(state.pick_deadline_at).getTime() <= Date.now()
    ) {
      const botResult = await Promise.race([
        runBotTurn(leagueId, {
          skipDelay: !interactive,
          fastPick: !interactive,
        }),
        new Promise<{ timedOut: true }>((resolve) => {
          setTimeout(() => resolve({ timedOut: true }), botWorkBudgetMs);
        }),
      ]);

      if (
        botResult &&
        "timedOut" in botResult &&
        botResult.timedOut &&
        !interactive
      ) {
        // Don't fail the draft load — bot progress can finish on the next poll.
      } else if (botResult && "error" in botResult && botResult.error) {
        await logLiveDraftProgressError(leagueId, "runBotTurn", botResult.error);
        return botResult;
      }
    }
  } else if (!state.on_clock_user_id) {
    const assign = await assignOnClock(leagueId);
    if (assign.error) {
      await logLiveDraftProgressError(leagueId, "assignOnClock", assign.error);
      return assign;
    }
  }

  state = await getLeagueDraftStateRow(leagueId);
  if (
    state?.status === "in_progress" &&
    !state.on_clock_user_id &&
    state.current_pick_index < state.total_pick_slots
  ) {
    const assign = await assignOnClock(leagueId);
    if (assign.error) {
      await logLiveDraftProgressError(leagueId, "assignOnClock-retry", assign.error);
      return assign;
    }
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

/** Reset the pick timer after a rejected pick so validation retries don't lose the turn. */
export async function extendPickDeadlineForUser(
  leagueId: string,
  userId: string
): Promise<void> {
  const supabase = await createClient();
  const state = await getLeagueDraftStateRow(leagueId);
  if (!state || state.on_clock_user_id !== userId) return;

  const { data: league } = await supabase
    .from("leagues")
    .select("pick_time_seconds")
    .eq("id", leagueId)
    .maybeSingle();

  const pickTimeSeconds = league?.pick_time_seconds ?? 120;
  await supabase
    .from("league_draft_state")
    .update({
      pick_deadline_at: new Date(
        Date.now() + pickTimeSeconds * 1000
      ).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("league_id", leagueId);
}

export async function describeLiveDraftClock(leagueId: string) {
  const state = await getLeagueDraftStateRow(leagueId);
  if (!state) return null;

  const expected = await peekNextOnClockUserId(leagueId, state);
  return {
    onClockUserId: state.on_clock_user_id,
    expectedOnClockUserId: expected,
    currentPickIndex: state.current_pick_index,
    globalPickNumber: state.global_pick_number,
    totalPickSlots: state.total_pick_slots,
    pickDeadlineAt: state.pick_deadline_at,
  };
}

export async function toggleSafetyPickQueue(
  userId: string,
  leagueId: string,
  symbol: string
): Promise<{ queue?: string[]; error?: string }> {
  const supabase = await createClient();

  const { data: draftRow, error: loadError } = await supabase
    .from("drafts")
    .select("safety_pick_queue, safety_pick_symbol")
    .eq("user_id", userId)
    .eq("league_id", leagueId)
    .maybeSingle();

  if (loadError) return { error: loadError.message };
  if (!draftRow) return { error: "Draft not found" };

  const current = normalizeSafetyPickQueue(
    draftRow.safety_pick_queue,
    draftRow.safety_pick_symbol
  );
  const { queue, error } = toggleSafetyPickQueueSymbol(current, symbol);
  if (error) return { error };

  const { error: updateError } = await supabase
    .from("drafts")
    .update({
      safety_pick_queue: queue,
      safety_pick_symbol: queue[0] ?? null,
    })
    .eq("user_id", userId)
    .eq("league_id", leagueId);

  if (updateError) return { error: updateError.message };
  return { queue };
}

/** @deprecated Use toggleSafetyPickQueue */
export async function setSafetyPickSymbol(
  userId: string,
  leagueId: string,
  symbol: string | null
): Promise<{ error?: string }> {
  if (symbol === null) {
    const supabase = await createClient();
    const { error } = await supabase
      .from("drafts")
      .update({ safety_pick_queue: [], safety_pick_symbol: null })
      .eq("user_id", userId)
      .eq("league_id", leagueId);
    if (error) return { error: error.message };
    return {};
  }

  const result = await toggleSafetyPickQueue(userId, leagueId, symbol);
  if (result.error) return { error: result.error };
  return {};
}
