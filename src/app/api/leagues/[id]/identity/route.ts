import { NextResponse } from "next/server";

import { getAuthenticatedUserId } from "@/lib/draft/server";
import {
  claimSdflDivisionSlot,
  loadLeagueIdentityPayload,
  submitSdflFranchiseIdentity,
} from "@/lib/league/team-identity";
import type { SdflConference, SdflDivision } from "@/lib/league/sdfl-divisions";

type RouteContext = { params: Promise<{ id: string }> };

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
} as const;

function parseSlotBody(body: Record<string, unknown>) {
  const conference = body.conference;
  const division = body.division;
  const divisionSlot = body.divisionSlot ?? body.division_slot;

  if (conference !== "sdal" && conference !== "sdnl") {
    return { error: "Invalid conference." };
  }
  if (
    division !== "north" &&
    division !== "south" &&
    division !== "east" &&
    division !== "west"
  ) {
    return { error: "Invalid division." };
  }
  if (
    typeof divisionSlot !== "number" ||
    !Number.isInteger(divisionSlot) ||
    divisionSlot < 1 ||
    divisionSlot > 4
  ) {
    return { error: "Division slot must be 1–4." };
  }

  return {
    slot: {
      conference: conference as SdflConference,
      division: division as SdflDivision,
      divisionSlot,
    },
  };
}

export async function GET(_request: Request, context: RouteContext) {
  const { user } = await getAuthenticatedUserId();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: leagueId } = await context.params;
  const result = await loadLeagueIdentityPayload(user.id, leagueId);
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

  const parsed = parseSlotBody(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const result = await claimSdflDivisionSlot(user.id, leagueId, parsed.slot);
  if (result.error || !result.identity) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status ?? 400, headers: NO_STORE_HEADERS }
    );
  }

  return NextResponse.json(
    { identity: result.identity },
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

  const franchiseCity =
    typeof body.franchiseCity === "string"
      ? body.franchiseCity
      : typeof body.city === "string"
        ? body.city
        : "";
  const teamName =
    typeof body.teamName === "string"
      ? body.teamName
      : typeof body.team_name === "string"
        ? body.team_name
        : "";
  const franchiseColors = body.franchiseColors ?? body.franchise_colors;

  const result = await submitSdflFranchiseIdentity(user.id, leagueId, {
    franchiseCity,
    teamName,
    franchiseColors,
  });

  if (result.error || !result.identity) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status ?? 400, headers: NO_STORE_HEADERS }
    );
  }

  return NextResponse.json(
    { identity: result.identity },
    { headers: NO_STORE_HEADERS }
  );
}
