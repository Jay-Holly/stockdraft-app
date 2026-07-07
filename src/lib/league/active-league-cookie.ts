export const ACTIVE_LEAGUE_COOKIE = "stockdraft_active_league_id";

export const activeLeagueCookieOptions = {
  path: "/",
  httpOnly: true,
  sameSite: "lax" as const,
  maxAge: 60 * 60 * 24 * 365,
};
