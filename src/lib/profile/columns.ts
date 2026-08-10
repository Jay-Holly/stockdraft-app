/**
 * Every column on `profiles` except `email`.
 *
 * `email` is deliberately not readable by the `anon` / `authenticated` roles —
 * see supabase/migrations/083_restrict_profile_email_visibility.sql. A plain
 * `.select("*")` on profiles (or a bare `.select()` after an insert) fails for
 * logged-in users because of that, so use this list instead.
 *
 * Server code that genuinely needs the email must go through
 * `createServiceClient()`.
 *
 * If you add a column to `profiles`, add it here and re-run migration 083.
 */
export const PROFILE_COLUMNS =
  "id, username, team_name, avatar_color, created_at, is_bot, day_trader_joined_at, is_admin";
