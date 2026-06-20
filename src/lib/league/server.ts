import { createClient } from "@/lib/supabase/server";

export type League = {
  id: string;
  name: string;
  is_solo: boolean;
  created_at: string;
};

export async function getOrCreateSoloLeague(
  userId: string,
  teamName: string
): Promise<{ league: League | null; error?: string }> {
  const supabase = await createClient();

  const { data: membership, error: membershipError } = await supabase
    .from("league_members")
    .select("league_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    return {
      league: null,
      error: `league_members lookup failed: ${membershipError.message}`,
    };
  }

  if (membership?.league_id) {
    const { data: existing, error: leagueLookupError } = await supabase
      .from("leagues")
      .select("id, name, is_solo, created_at")
      .eq("id", membership.league_id)
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

  if (error || !data) return new Set();

  return new Set(
    (data as { symbol: string }[]).map((row) => row.symbol.toUpperCase())
  );
}

export async function getPlatformRosteredSymbols(): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_platform_rostered_stock_symbols");

  if (error || !data) return [];

  return (data as { symbol: string }[]).map((row) => row.symbol.toUpperCase());
}
