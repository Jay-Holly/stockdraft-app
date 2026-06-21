import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { applyWaiverClaim } from "@/lib/roster/moves";
import { loadFreeAgentsPageData } from "@/lib/roster/server";

export async function POST(request: Request) {
  const { user } = await getAuthenticatedUserId();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    droppedPickId?: string;
    symbol?: string;
  };

  if (!body.droppedPickId || !body.symbol) {
    return NextResponse.json(
      { error: "droppedPickId and symbol are required." },
      { status: 400 }
    );
  }

  const result = await applyWaiverClaim(
    user.id,
    body.droppedPickId,
    body.symbol
  );
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const data = await loadFreeAgentsPageData(user.id);
  if (!data.ok) {
    return NextResponse.json({ error: data.error }, { status: 500 });
  }

  return NextResponse.json(data.data);
}
