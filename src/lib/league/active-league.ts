import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { AiLeague } from "@/lib/league/ai-league";

export const ACTIVE_LEAGUE_COOKIE = "stockdraft_active_league_id";

const COOKIE_OPTIONS = {
  path: "/",
  httpOnly: true,
  sameSite: "lax" as const,
  maxAge: 60 * 60 * 24 * 365,
};

export async function getActiveLeagueIdFromCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(ACTIVE_LEAGUE_COOKIE)?.value ?? null;
}

export async function setActiveLeagueCookie(leagueId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_LEAGUE_COOKIE, leagueId, COOKIE_OPTIONS);
}

export async function verifyUserOwnsLeague(
  userId: string,
  leagueId: string
): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("leagues")
    .select("id")
    .eq("id", leagueId)
    .eq("owner_user_id", userId)
    .eq("league_type", "ai")
    .maybeSingle();

  return !!data;
}

export async function getAiLeagueById(
  leagueId: string
): Promise<AiLeague | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("leagues")
    .select("id, name, is_solo, created_at, league_type, status, owner_user_id")
    .eq("id", leagueId)
    .eq("league_type", "ai")
    .maybeSingle();

  return (data as AiLeague | null) ?? null;
}

export async function listAiLeaguesForUser(
  userId: string
): Promise<AiLeague[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("leagues")
    .select("id, name, is_solo, created_at, league_type, status, owner_user_id")
    .eq("owner_user_id", userId)
    .eq("league_type", "ai")
    .order("created_at", { ascending: false });

  return (data as AiLeague[] | null) ?? [];
}

export async function resolveActiveAiLeagueId(
  userId: string,
  preferredLeagueId?: string | null
): Promise<string | null> {
  if (preferredLeagueId) {
    if (await verifyUserOwnsLeague(userId, preferredLeagueId)) {
      return preferredLeagueId;
    }
  }

  const cookieId = await getActiveLeagueIdFromCookie();
  if (cookieId && (await verifyUserOwnsLeague(userId, cookieId))) {
    return cookieId;
  }

  const supabase = await createClient();

  const { data: inProgress } = await supabase
    .from("leagues")
    .select("id")
    .eq("owner_user_id", userId)
    .eq("league_type", "ai")
    .in("status", ["drafting", "active"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (inProgress?.id) return inProgress.id;

  const { data: latest } = await supabase
    .from("leagues")
    .select("id")
    .eq("owner_user_id", userId)
    .eq("league_type", "ai")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return latest?.id ?? null;
}

export async function resolveActiveAiLeague(
  userId: string,
  preferredLeagueId?: string | null
): Promise<AiLeague | null> {
  const leagueId = await resolveActiveAiLeagueId(userId, preferredLeagueId);
  if (!leagueId) return null;
  return getAiLeagueById(leagueId);
}
