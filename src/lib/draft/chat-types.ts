export type DraftChatMessageType = "human" | "bot_reaction";

export type DraftChatMessage = {
  id: string;
  league_id: string;
  user_id: string | null;
  author_name: string;
  body: string;
  message_type: DraftChatMessageType;
  reaction_key: string | null;
  draft_event_id: string | null;
  created_at: string;
};
