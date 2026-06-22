import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import {
  getDraftChatMessages,
  postHumanDraftChatMessage,
} from "@/lib/draft/chat";
import { resolveActiveAiLeagueId, verifyUserOwnsLeague } from "@/lib/league/active-league";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { user } = await getAuthenticatedUserId();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const leagueId = await resolveActiveAiLeagueId(
    user.id,
    url.searchParams.get("leagueId")
  );

  if (!leagueId) {
    return NextResponse.json({ error: "No active league found." }, { status: 400 });
  }

  const messages = await getDraftChatMessages(leagueId);
  return NextResponse.json({ messages, leagueId });
}

export async function POST(request: Request) {
  const { user } = await getAuthenticatedUserId();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { leagueId?: string; message?: string };
  const leagueId = await resolveActiveAiLeagueId(user.id, body.leagueId ?? null);

  if (!leagueId) {
    return NextResponse.json({ error: "No active league found." }, { status: 400 });
  }

  if (!(await verifyUserOwnsLeague(user.id, leagueId))) {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const { data: member } = await supabase
      .from("league_members")
      .select("user_id")
      .eq("league_id", leagueId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!member) {
      return NextResponse.json({ error: "League not found." }, { status: 404 });
    }
  }

  const result = await postHumanDraftChatMessage(
    user.id,
    leagueId,
    body.message ?? ""
  );

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ message: result.message });
}
