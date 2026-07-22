import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";

export const dynamic = "force-dynamic";

type EnterBody = {
  contestId?: string;
  picks?: { sector: string; symbol: string }[];
};

export async function POST(request: Request) {
  try {
    const { supabase, user } = await getAuthenticatedUserId();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as EnterBody;
    const contestId = body.contestId?.trim();
    const picks = body.picks ?? [];

    if (!contestId) {
      return NextResponse.json(
        { error: "Missing contest." },
        { status: 400 }
      );
    }
    if (picks.length !== 12) {
      return NextResponse.json(
        { error: "Lineup must have exactly 12 picks." },
        { status: 400 }
      );
    }

    const { data: contest, error: contestError } = await supabase
      .from("sdwfs_contests")
      .select("id, status")
      .eq("id", contestId)
      .maybeSingle();

    if (contestError || !contest) {
      return NextResponse.json(
        { error: "Contest not found." },
        { status: 404 }
      );
    }
    if (contest.status !== "open") {
      return NextResponse.json(
        { error: "This contest is locked." },
        { status: 400 }
      );
    }

    const { data: entry, error: entryError } = await supabase
      .from("sdwfs_entries")
      .insert({ contest_id: contestId, user_id: user.id })
      .select("id")
      .single();

    if (entryError || !entry) {
      return NextResponse.json(
        {
          error:
            entryError?.code === "23505"
              ? "You've already entered this contest."
              : "Could not create entry.",
        },
        { status: 400 }
      );
    }

    const { error: picksError } = await supabase.from("sdwfs_entry_picks").insert(
      picks.map((pick) => ({
        entry_id: entry.id,
        sector: pick.sector,
        symbol: pick.symbol,
      }))
    );

    if (picksError) {
      await supabase.from("sdwfs_entries").delete().eq("id", entry.id);
      return NextResponse.json(
        { error: "Could not save your lineup." },
        { status: 400 }
      );
    }

    return NextResponse.json({ entryId: entry.id });
  } catch (error) {
    console.error("SDWFS enter error:", error);
    return NextResponse.json(
      { error: "Could not enter SDWFS contest." },
      { status: 500 }
    );
  }
}
