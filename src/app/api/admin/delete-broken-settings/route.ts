import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export async function POST() {
  try {
    const supabase = createServiceClient();
    const leagueId = "d980461b-bbc8-4913-8d79-ce6feb27131f";

    const { error } = await supabase
      .from("league_season_settings")
      .delete()
      .eq("league_id", leagueId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, message: "Deleted broken league_season_settings" });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
