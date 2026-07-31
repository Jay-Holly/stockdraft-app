import { getSdwfsContestLeaderboard } from "@/lib/sdwfs/leaderboard";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const revalidate = 0;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ contestId: string }> }
) {
  const { contestId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { prizePool, isFinal, rows } = await getSdwfsContestLeaderboard(
    contestId,
    user?.id ?? null
  );

  return NextResponse.json({ prizePool, isFinal, rows });
}
