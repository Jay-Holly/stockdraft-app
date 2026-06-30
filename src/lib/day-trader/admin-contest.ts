import "server-only";

import { isDayTraderAdmin } from "@/lib/day-trader/admin-access";
import { syncDayTraderContestLifecycle } from "@/lib/day-trader/contest-lifecycle";
import type { DayTraderContestRow } from "@/lib/day-trader/types";
import { createClient } from "@/lib/supabase/server";

export type DayTraderAdminContestUpdate = {
  contestName: string;
  dollarPrizeText: string;
  percentPrizeText: string;
};

export type UpdateDayTraderContestResult =
  | { ok: true; contest: DayTraderContestRow }
  | { ok: false; error: string };

export async function listDayTraderContestsForAdmin(
  limit = 12
): Promise<DayTraderContestRow[]> {
  await syncDayTraderContestLifecycle();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("day_trader_contests")
    .select("*")
    .order("week_start_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to load contests: ${error.message}`);
  }

  return (data as DayTraderContestRow[]) ?? [];
}

export async function updateDayTraderContestAdmin(
  userId: string,
  contestId: string,
  input: DayTraderAdminContestUpdate
): Promise<UpdateDayTraderContestResult> {
  if (!(await isDayTraderAdmin(userId))) {
    return { ok: false, error: "Admin access required." };
  }

  const contestName = input.contestName.trim();
  if (!contestName) {
    return { ok: false, error: "Contest name is required." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("day_trader_contests")
    .update({
      contest_name: contestName,
      dollar_prize_text: input.dollarPrizeText.trim(),
      percent_prize_text: input.percentPrizeText.trim(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", contestId)
    .select("*")
    .single();

  if (error || !data) {
    return {
      ok: false,
      error: error?.message ?? "Could not update contest.",
    };
  }

  return { ok: true, contest: data as DayTraderContestRow };
}
