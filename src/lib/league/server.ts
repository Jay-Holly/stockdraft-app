import { createClient } from "@/lib/supabase/server";
import {
  getAiLeagueById,
  resolveActiveAiLeagueId,
} from "@/lib/league/active-league";
import { LEAGUE_BASE_FIELDS } from "@/lib/league/fields";

export type League = {
  id: string;
  name: string;
  is_solo: boolean;
  created_at: string;
  support_code: string;
};

export async function getOrCreateSoloLeague(
  userId: string,
  teamName: string
): Promise<{ league: League | null; error?: string }> {
  const supabase = await createClient();

  const { data: membership, error: membershipError } = await supabase
    .from("league_members")
    .select(`league_id, leagues!inner(${LEAGUE_BASE_FIELDS})`)
    .eq("user_id", userId)
    .eq("leagues.is_solo", true)
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    return {
      league: null,
      error: `league_members lookup failed: ${membershipError.message}`,
    };
  }

  if (membership?.leagues) {
    const leagueRow = Array.isArray(membership.leagues)
      ? membership.leagues[0]
      : membership.leagues;
    if (leagueRow) {
      return { league: leagueRow as League };
    }
  }

  if (membership?.league_id) {
    const { data: existing, error: leagueLookupError } = await supabase
      .from("leagues")
      .select(LEAGUE_BASE_FIELDS)
      .eq("id", membership.league_id)
      .eq("is_solo", true)
      .single();

    if (leagueLookupError) {
      return {
        league: null,
        error: `leagues lookup failed: ${leagueLookupError.message}`,
      };
    }

    if (existing) return { league: existing as League };
  }

  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .insert({
      name: `${teamName} Solo League`,
      is_solo: true,
    })
    .select("*")
    .single();

  if (leagueError || !league) {
    return {
      league: null,
      error: `leagues insert failed: ${leagueError?.message ?? "unknown error"}`,
    };
  }

  const { error: memberError } = await supabase.from("league_members").insert({
    league_id: league.id,
    user_id: userId,
  });

  if (memberError) {
    return {
      league: null,
      error: `league_members insert failed: ${memberError.message}`,
    };
  }

  return { league: league as League };
}

export async function getLeagueOffBoardSymbols(
  leagueId: string
): Promise<Set<string>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_league_drafted_stock_symbols", {
    p_league_id: leagueId,
  });

  if (error) {
    console.error("get_league_drafted_stock_symbols failed:", error.message);
    throw new Error(
      `Could not load league off-board symbols: ${error.message}. Confirm migrations 003 and 022 are applied in Supabase.`
    );
  }

  if (!data) return new Set();

  return new Set(
    (data as { symbol: string }[]).map((row) => row.symbol.toUpperCase())
  );
}

export async function countLeagueRosteredSymbol(
  leagueId: string,
  symbol: string
): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("count_league_rostered_symbol", {
    p_league_id: leagueId,
    p_symbol: symbol.toUpperCase(),
  });

  if (error) {
    console.error("count_league_rostered_symbol failed:", error.message);
    throw new Error(
      `Could not verify league roster for ${symbol}: ${error.message}. Confirm migration 022 is applied in Supabase.`
    );
  }

  return typeof data === "number" ? data : 0;
}

export async function resolveDraftLeague(
  userId: string,
  teamName: string,
  options?: { leagueId?: string }
): Promise<{ league: League | null; error?: string }> {
  const supabase = await createClient();

  if (options?.leagueId) {
    const { data, error } = await supabase
      .from("leagues")
      .select(LEAGUE_BASE_FIELDS)
      .eq("id", options.leagueId)
      .single();

    if (error || !data) {
      return {
        league: null,
        error: error?.message ?? "League not found",
      };
    }

    return { league: data as League };
  }

  const activeLeagueId = await resolveActiveAiLeagueId(userId);
  if (activeLeagueId) {
    const activeLeague = await getAiLeagueById(activeLeagueId);
    if (activeLeague) {
      return { league: activeLeague as League };
    }
  }

  const { data: aiLeague, error: aiError } = await supabase
    .from("leagues")
    .select(LEAGUE_BASE_FIELDS)
    .eq("owner_user_id", userId)
    .eq("league_type", "ai")
    .in("status", ["drafting", "active"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (aiError) {
    return { league: null, error: aiError.message };
  }

  if (aiLeague) {
    return { league: aiLeague as League };
  }

  const { data: latestAiLeague } = await supabase
    .from("leagues")
    .select(LEAGUE_BASE_FIELDS)
    .eq("owner_user_id", userId)
    .eq("league_type", "ai")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestAiLeague) {
    return { league: latestAiLeague as League };
  }

  return getOrCreateSoloLeague(userId, teamName);
}

export async function getPlatformRosteredSymbols(): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_platform_rostered_stock_symbols");

  if (error || !data) return [];

  return (data as { symbol: string }[]).map((row) => row.symbol.toUpperCase());
}
