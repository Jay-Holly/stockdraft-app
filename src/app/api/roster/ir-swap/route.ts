import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { applyIrSwap } from "@/lib/roster/moves";

export async function POST(request: Request) {
  const { user } = await getAuthenticatedUserId();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    starterPickId?: string;
    benchPickId?: string;
  };

  if (!body.starterPickId || !body.benchPickId) {
    return NextResponse.json(
      { error: "starterPickId and benchPickId are required." },
      { status: 400 }
    );
  }

  const result = await applyIrSwap(
    user.id,
    body.starterPickId,
    body.benchPickId
  );
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
