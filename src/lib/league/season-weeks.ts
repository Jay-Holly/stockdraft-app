import { createClient } from "@/lib/supabase/server";
import { getScheduledWeekNumbers } from "@/lib/matchup/league-teams";
import { getCurrentWeek } from "@/lib/roster/weekly";

export type SeasonWeekContext = {
  currentWeek: number;
  maxViewableWeek: number;
  availableWeeks: number[];
  leagueStatus: string;
};

export function buildAvailableWeeks(maxViewableWeek: number): number[] {
  if (maxViewableWeek < 1) return [1];
  return Array.from({ length: maxViewableWeek }, (_, index) => index + 1);
}

export function clampViewWeek(
  weekNumber: number | null | undefined,
  maxViewableWeek: number
): number {
  const parsed = Number(weekNumber);
  if (!Number.isFinite(parsed) || parsed < 1) return maxViewableWeek;
  return Math.min(Math.max(1, Math.floor(parsed)), maxViewableWeek);
}

export async function getSeasonWeekContext(
  leagueId: string,
  userId: string
): Promise<SeasonWeekContext> {
  const supabase = await createClient();

  const [{ data: league }, standingsWeek, scheduledWeeks] = await Promise.all([
    supabase
      .from("leagues")
      .select("current_week, status")
      .eq("id", leagueId)
      .maybeSingle(),
    getCurrentWeek(supabase, leagueId, userId),
    getScheduledWeekNumbers(leagueId),
  ]);

  const currentWeek = league?.current_week ?? standingsWeek ?? 1;
  const maxScheduledWeek =
    scheduledWeeks.length > 0 ? scheduledWeeks[scheduledWeeks.length - 1] : 1;

  const maxViewableWeek = Math.max(currentWeek, maxScheduledWeek);

  return {
    currentWeek,
    maxViewableWeek,
    availableWeeks: buildAvailableWeeks(maxViewableWeek),
    leagueStatus: league?.status ?? "active",
  };
}
