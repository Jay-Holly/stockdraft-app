import "server-only";

import { isDayTraderAdmin } from "@/lib/day-trader/admin-access";
import {
  createDayTraderEntry,
  type CreateDayTraderEntryResult,
} from "@/lib/day-trader/entry";
import { createClient } from "@/lib/supabase/server";

export type ForceDayTraderEntryInput = {
  supportCode?: string;
  leagueId?: string;
  userId?: string;
  contestId?: string;
};

export type ForceDayTraderEntryResult = CreateDayTraderEntryResult;

export async function resolveLeagueIdBySupportCode(
  supportCode: string
): Promise<{ leagueId: string; leagueName: string } | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("leagues")
    .select("id, name")
    .eq("support_code", supportCode.trim().toUpperCase())
    .maybeSingle();

  if (!data) return null;
  return { leagueId: data.id, leagueName: data.name };
}

export async function forceDayTraderAdminEntry(
  adminUserId: string,
  input: ForceDayTraderEntryInput
): Promise<ForceDayTraderEntryResult> {
  if (!(await isDayTraderAdmin(adminUserId))) {
    return { ok: false, error: "Admin access required." };
  }

  const targetUserId = input.userId?.trim() || adminUserId;

  let leagueId = input.leagueId?.trim();
  if (!leagueId && input.supportCode?.trim()) {
    const league = await resolveLeagueIdBySupportCode(input.supportCode);
    if (!league) {
      return {
        ok: false,
        error: `League not found for support code ${input.supportCode.trim().toUpperCase()}.`,
      };
    }
    leagueId = league.leagueId;
  }

  if (!leagueId) {
    return {
      ok: false,
      error: "Provide leagueId or supportCode (e.g. SDAI-00039).",
    };
  }

  return createDayTraderEntry(targetUserId, leagueId, new Date(), {
    bypassEntryWindow: true,
    contestId: input.contestId?.trim(),
  });
}
