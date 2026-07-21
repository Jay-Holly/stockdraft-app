/**
 * Drive a single SDFL league's already-seeded, already-day-paced schedule
 * forward through its remaining regular-season weeks and playoff rounds,
 * without waiting on real calendar days. The schedule itself (real 2024
 * NFL mirroring, finalize_at spaced 1 real day apart) is untouched —
 * this just calls the same finalizeMatchupsForLeagueWeek() the daily cron
 * would call, repeatedly, scoped to exactly one league.
 *
 * Run: npx --yes tsx scripts/advance-sdfl-league.ts --support-code=SDFL-00073
 */
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

const envPath = path.join(__dirname, "..", ".env.local");
const envText = fs.readFileSync(envPath, "utf8");
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const onlyCodeArg = process.argv.find((a) => a.startsWith("--support-code="));
const SUPPORT_CODE = onlyCodeArg ? onlyCodeArg.split("=")[1] : null;
const MAX_ROUNDS = 30;

async function main() {
  if (!SUPPORT_CODE) {
    console.error("Usage: --support-code=SDFL-00073");
    process.exit(1);
  }

  const { finalizeMatchupsForLeagueWeek } = await import(
    "../src/lib/matchup/scoring"
  );

  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .select("id, support_code, status, current_week")
    .eq("support_code", SUPPORT_CODE)
    .maybeSingle();

  if (leagueError || !league) {
    console.error("League not found:", leagueError?.message ?? SUPPORT_CODE);
    process.exit(1);
  }

  console.log(`Starting: ${league.support_code} status=${league.status} current_week=${league.current_week}`);

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const { data: current } = await supabase
      .from("leagues")
      .select("status, current_week")
      .eq("id", league.id)
      .maybeSingle();

    if (!current || current.status === "complete") {
      console.log(`Season complete. Final status=${current?.status}`);
      break;
    }

    const { data: scheduled } = await supabase
      .from("league_matchups")
      .select("week_number")
      .eq("league_id", league.id)
      .eq("status", "scheduled")
      .order("week_number", { ascending: true })
      .limit(1);

    const weekNumber = scheduled?.[0]?.week_number;
    if (!weekNumber) {
      console.log("No scheduled weeks remain, but league not marked complete — stopping.");
      break;
    }

    console.log(`Finalizing week ${weekNumber}...`);
    const result = await finalizeMatchupsForLeagueWeek(
      league.id,
      weekNumber,
      new Date(),
      supabase as any
    );

    if (result.error) {
      console.error(`  ERROR week ${weekNumber}: ${result.error}`);
      break;
    }
    console.log(`  week ${weekNumber} finalized=${result.finalized}`);

    if (!result.finalized) {
      console.log("  Nothing finalized this round — stopping to avoid an infinite loop.");
      break;
    }
  }

  const { data: final } = await supabase
    .from("leagues")
    .select("status, current_week")
    .eq("id", league.id)
    .maybeSingle();
  console.log(`Done. status=${final?.status} current_week=${final?.current_week}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
