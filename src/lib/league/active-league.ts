import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { AiLeague } from "@/lib/league/ai-league";
import type { HumanLeague } from "@/lib/league/human-league";
import { AI_LEAGUE_FIELDS, HUMAN_LEAGUE_FIELDS } from "@/lib/league/fields";
import {
  ACTIVE_LEAGUE_COOKIE,
  activeLeagueCookieOptions,
} from "@/lib/league/active-league-cookie";

export { ACTIVE_LEAGUE_COOKIE } from "@/lib/league/active-league-cookie";

export async function getActiveLeagueIdFromCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(ACTIVE_LEAGUE_COOKIE)?.value ?? null;
}

export async function setActiveLeagueCookie(leagueId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_LEAGUE_COOKIE, leagueId, activeLeagueCookieOptions);
}

export async function clearActiveLeagueCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(ACTIVE_LEAGUE_COOKIE);
}

export async function verifyUserIsLeagueMember(
  userId: string,
  leagueId: string
): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("league_members")
    .select("user_id")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .maybeSingle();

  return !!data;
}

export async function verifyUserCanAccessLeague(
  userId: string,
  leagueId: string
): Promise<boolean> {
  if (await verifyUserOwnsLeague(userId, leagueId)) return true;

  const supabase = await createClient();
  const { data: humanLeague } = await supabase
    .from("leagues")
    .select("id")
    .eq("id", leagueId)
    .eq("league_type", "human")
    .maybeSingle();

  if (!humanLeague) return false;
  return verifyUserIsLeagueMember(userId, leagueId);
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

export async function getHumanLeagueById(
  leagueId: string
): Promise<HumanLeague | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("leagues")
    .select(HUMAN_LEAGUE_FIELDS)
    .eq("id", leagueId)
    .eq("league_type", "human")
    .maybeSingle();

  return (data as HumanLeague | null) ?? null;
}

export async function getAiLeagueById(
  leagueId: string
): Promise<AiLeague | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("leagues")
    .select(AI_LEAGUE_FIELDS)
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
    .select(AI_LEAGUE_FIELDS)
    .eq("owner_user_id", userId)
    .eq("league_type", "ai")
    .order("created_at", { ascending: false });

  return (data as AiLeague[] | null) ?? [];
}

export async function resolveActiveLeagueId(
  userId: string,
  preferredLeagueId?: string | null
): Promise<string | null> {
  if (preferredLeagueId) {
    if (await verifyUserCanAccessLeague(userId, preferredLeagueId)) {
      return preferredLeagueId;
    }
  }

  const cookieId = await getActiveLeagueIdFromCookie();
  if (cookieId && (await verifyUserCanAccessLeague(userId, cookieId))) {
    return cookieId;
  }

  const supabase = await createClient();

  const { data: memberRows } = await supabase
    .from("league_members")
    .select("league_id")
    .eq("user_id", userId);

  const memberLeagueIds = (memberRows ?? []).map((row) => row.league_id);

  if (memberLeagueIds.length > 0) {
    const { data: humanInProgress } = await supabase
      .from("leagues")
      .select("id")
      .in("id", memberLeagueIds)
      .eq("league_type", "human")
      .in("status", ["waiting", "drafting", "active"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (humanInProgress?.id) return humanInProgress.id;
  }

  const aiId = await resolveActiveAiLeagueId(userId);
  if (aiId) return aiId;

  if (memberLeagueIds.length > 0) {
    const { data: humanLatest } = await supabase
      .from("leagues")
      .select("id")
      .in("id", memberLeagueIds)
      .eq("league_type", "human")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return humanLatest?.id ?? null;
  }

  return null;
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
