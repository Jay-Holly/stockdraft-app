export const LEAGUE_BASE_FIELDS =
  "id, name, is_solo, created_at, support_code";

export const AI_LEAGUE_FIELDS = `${LEAGUE_BASE_FIELDS}, league_type, status, owner_user_id, scoring_mode`;

export const HUMAN_LEAGUE_FIELDS = `${LEAGUE_BASE_FIELDS}, league_type, status, owner_user_id, format_type, player_count, visibility, opponent_type, invite_token, invite_email, scoring_mode`;
