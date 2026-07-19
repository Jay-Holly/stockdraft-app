import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { createClient } from "@/lib/supabase/server";
import { resolveSeasonLeague } from "@/lib/roster/server";

export const dynamic = "force-dynamic";

/** Only accept logos we actually host, so this can't be pointed at arbitrary URLs. */
function isOwnStorageUrl(url: string, supabaseUrl: string): boolean {
  try {
    const parsed = new URL(url);
    const base = new URL(supabaseUrl);
    return (
      parsed.origin === base.origin &&
      parsed.pathname.includes("/storage/v1/object/public/team-logos/")
    );
  } catch {
    return false;
  }
}

async function resolveLeagueId(userId: string): Promise<string | null> {
  const league = await resolveSeasonLeague(userId);
  return league?.id ?? null;
}

export async function POST(request: Request) {
  try {
    const { user } = await getAuthenticatedUserId();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as { logoUrl?: string };
    const logoUrl = body.logoUrl?.trim();

    if (!logoUrl) {
      return NextResponse.json(
        { error: "logoUrl is required." },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    if (!isOwnStorageUrl(logoUrl, supabaseUrl)) {
      return NextResponse.json(
        { error: "Logo must be an uploaded team-logos file." },
        { status: 400 }
      );
    }

    const leagueId = await resolveLeagueId(user.id);
    if (!leagueId) {
      return NextResponse.json(
        { error: "No active league found for this account." },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from("league_members")
      .update({ logo_url: logoUrl })
      .eq("league_id", leagueId)
      .eq("user_id", user.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, logoUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Saving logo failed.";
    console.error("Team logo route error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const { user } = await getAuthenticatedUserId();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const leagueId = await resolveLeagueId(user.id);
    if (!leagueId) {
      return NextResponse.json(
        { error: "No active league found for this account." },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from("league_members")
      .update({ logo_url: null })
      .eq("league_id", leagueId)
      .eq("user_id", user.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Removing logo failed.";
    console.error("Team logo delete error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
