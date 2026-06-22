import { createClient } from "@/lib/supabase/server";
import type { DraftFeedEvent } from "@/lib/draft/types";
import type { DraftChatMessage } from "@/lib/draft/chat-types";
import { generateBotReactionsForDraftEvent } from "@/lib/draft/chat-reactions";
import { getLeagueBotMembers } from "@/lib/league/league-bots";

export async function getDraftChatMessages(
  leagueId: string,
  limit = 200
): Promise<DraftChatMessage[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("league_draft_chat_messages")
    .select("*")
    .eq("league_id", leagueId)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error || !data) return [];
  return data as DraftChatMessage[];
}

export async function postHumanDraftChatMessage(
  userId: string,
  leagueId: string,
  body: string
): Promise<{ message?: DraftChatMessage; error?: string }> {
  const trimmed = body.trim();
  if (!trimmed) return { error: "Message cannot be empty." };
  if (trimmed.length > 500) {
    return { error: "Message must be 500 characters or fewer." };
  }

  const supabase = await createClient();

  const { data: member } = await supabase
    .from("league_members")
    .select("display_name")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .maybeSingle();

  let authorName = member?.display_name ?? null;
  if (!authorName) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("team_name, username")
      .eq("id", userId)
      .maybeSingle();
    authorName = profile?.team_name ?? profile?.username ?? "Manager";
  }

  const { data, error } = await supabase
    .from("league_draft_chat_messages")
    .insert({
      league_id: leagueId,
      user_id: userId,
      author_name: authorName,
      body: trimmed,
      message_type: "human",
    })
    .select("*")
    .single();

  if (error || !data) {
    return { error: error?.message ?? "Could not post message" };
  }

  return { message: data as DraftChatMessage };
}

export async function postBotReactionsForDraftEvent(
  leagueId: string,
  event: DraftFeedEvent,
  options?: { pushbackSkipsRemaining?: number }
): Promise<void> {
  const leagueBots = await getLeagueBotMembers(leagueId);
  if (leagueBots.length === 0) return;

  const reactions = generateBotReactionsForDraftEvent(event, leagueBots, options);
  if (reactions.length === 0) return;

  const supabase = await createClient();
  for (const reaction of reactions) {
    const { error } = await supabase.from("league_draft_chat_messages").insert({
      league_id: leagueId,
      user_id: reaction.userId,
      author_name: reaction.authorName,
      body: reaction.body,
      message_type: "bot_reaction",
      reaction_key: reaction.reactionKey,
      draft_event_id: reaction.draftEventId,
    });

    if (error?.code === "23505") continue;
  }
}
