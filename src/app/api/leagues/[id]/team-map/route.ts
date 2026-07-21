import { NextResponse } from "next/server";

import { getAuthenticatedUserId } from "@/lib/draft/server";
import {
  claimGenericMapSlot,
  loadGenericMapPayload,
  submitGenericFranchiseIdentity,
} from "@/lib/league/generic-team-map";

type RouteContext = { params: Promise<{ id: string }> };

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
} as const;

export async function GET(_request: Request, context: RouteContext) {
  const { user } = await getAuthenticatedUserId();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: leagueId } = await context.params;
  const result = await loadGenericMapPayload(user.id, leagueId);
  if (result.error || !result.payload) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status ?? 400, headers: NO_STORE_HEADERS }
    );
  }

  return NextResponse.json(result.payload, { headers: NO_STORE_HEADERS });
}

export async function POST(request: Request, context: RouteContext) {
  const { user } = await getAuthenticatedUserId();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: leagueId } = await context.params;
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const slotKey = body.slotKey;
  if (typeof slotKey !== "string" || slotKey.length === 0) {
    return NextResponse.json({ error: "slotKey is required." }, { status: 400 });
  }

  const result = await claimGenericMapSlot(user.id, leagueId, slotKey);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status ?? 400, headers: NO_STORE_HEADERS }
    );
  }

  const payloadResult = await loadGenericMapPayload(user.id, leagueId);
  return NextResponse.json(
    payloadResult.payload ?? { ok: true },
    { headers: NO_STORE_HEADERS }
  );
}

export async function PATCH(request: Request, context: RouteContext) {
  const { user } = await getAuthenticatedUserId();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: leagueId } = await context.params;
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const franchiseCity = typeof body.franchiseCity === "string" ? body.franchiseCity : "";
  const teamName = typeof body.teamName === "string" ? body.teamName : "";
  const franchiseColors = body.franchiseColors;

  const result = await submitGenericFranchiseIdentity(user.id, leagueId, {
    franchiseCity,
    teamName,
    franchiseColors,
  });

  if (result.error || !result.payload) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status ?? 400, headers: NO_STORE_HEADERS }
    );
  }

  return NextResponse.json(result.payload, { headers: NO_STORE_HEADERS });
}
