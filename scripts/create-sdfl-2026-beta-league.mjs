#!/usr/bin/env node
/**
 * Creates a new SDFL 2026 league via direct DB writes (service role),
 * reusing the same 6 real human user_ids from SDFL-00102, filling the
 * remaining 26 slots with bots (same mechanism the app's normal bot-fill
 * uses: provision_league_bot RPC + SDFL identity assignment).
 *
 * Bots are deliberately kept OUT of the 6 SDFL division slots that map to
 * the real teams holding the 2026 NFL Draft's original picks 1-6 (Raiders,
 * Jets, Cardinals, Titans, Giants, Browns) — those are left as the only 6
 * open slots, so however the 6 humans claim identity in-app, they end up
 * controlling exactly those 6 franchises. Since SDFL's draft order mirrors
 * the real draft's original pick order, that means the 6 humans' picks land
 * back-to-back at the very start (picks 1-6) with no bots interleaved,
 * instead of scattered across the whole draft (user's actual complaint
 * about the previous test league).
 *
 * The 6 humans still pick their own city/team name/colors through the
 * app's normal identity flow — this script only reserves WHICH real team
 * each open slot corresponds to, not the cosmetic details.
 *
 * Usage:
 *   node --env-file=.env.local scripts/create-sdfl-2026-beta-league.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    const key = line.slice(0, index);
    const value = line.slice(index + 1).replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvFile(path.join(process.cwd(), ".env.local"));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Same 6 human users from SDFL-00102 (verified via league_members query —
// the rows with no bot_personality set).
const HUMAN_USER_IDS = [
  "534054c5-6789-47db-8241-d0549b4541db", // #1 — was SDFL-00102's owner
  "790a3c61-d0c3-4c79-a1b3-3a93cc0af42d", // #2
  "d6bf111b-13c3-44f4-97e3-6cf1c9f6de98", // #3
  "cd628258-7aae-4bcc-acef-04868f284000", // #4
  "e1072a4b-cbae-4548-bd0a-5746165b41a6", // #5
  "13b71dc9-3e52-4bbe-9423-9bb851b47acf", // #6
];

const OWNER_USER_ID = HUMAN_USER_IDS[0];
const PLAYER_COUNT = 32;

const ALL_BOT_PERSONALITIES = [
  "analyst", "gambler", "crypto_king", "value_hunter", "sector_loyalist",
  "contrarian", "momentum_chaser", "diversifier", "day_trader", "sleeper",
  "homer", "bench_hoarder",
];

const CONFERENCES = ["sdal", "sdnl"];
const DIVISIONS = ["north", "south", "east", "west"];
const SDFL_DIVISION_SLOTS = CONFERENCES.flatMap((conference) =>
  DIVISIONS.flatMap((division) =>
    [1, 2, 3, 4].map((divisionSlot) => ({ conference, division, divisionSlot }))
  )
);

const BOT_CITIES = [
  "Ashford", "Bayview", "Cedar Falls", "Dunmore", "Eastbrook", "Fairmont",
  "Granite Bay", "Harbor Point", "Ironwood", "Kingsbridge", "Lakewood",
  "Milltown", "Northgate", "Oakridge", "Pinehurst", "Quail Run", "Ridgeline",
  "Silver Creek", "Thornfield", "Unionville", "Valley Forge", "Westhaven",
  "Yorktown", "Zephyr Hills", "Brookhaven", "Clearwater",
];
const BOT_PREFIXES = ["Crimson", "Silver", "Golden", "Midnight", "Thunder", "Iron", "Royal", "Storm"];
const BOT_SUFFIXES = ["Wolves", "Hawks", "Stallions", "Phantoms", "Guardians", "Sentinels", "Marauders", "Voyagers"];
const BOT_COLOR_PAIRS = [
  { primary: "#0a3d8f", secondary: "#d0ab48" },
  { primary: "#ef4444", secondary: "#f8fafc" },
  { primary: "#10b981", secondary: "#0f172a" },
  { primary: "#8b5cf6", secondary: "#f97316" },
  { primary: "#0369a1", secondary: "#94a3b8" },
  { primary: "#b45309", secondary: "#1e293b" },
  { primary: "#be123c", secondary: "#e2e8f0" },
  { primary: "#047857", secondary: "#fcd34d" },
];

function slotKey(slot) {
  return `${slot.conference}:${slot.division}:${slot.divisionSlot}`;
}

// The 6 SDFL slots that map to the real teams holding the 2026 NFL Draft's
// original picks 1-6 (per REAL_NFL_ALIGNMENT in src/lib/sim/nfl-team-alignment.ts).
// Reserved for the 6 human users — bots must not take these.
const RESERVED_HUMAN_SLOTS = new Set([
  "sdal:west:4",  // LV  — pick 1
  "sdal:east:4",  // NYJ — pick 2
  "sdnl:west:1",  // ARI — pick 3
  "sdal:south:4", // TEN — pick 4
  "sdnl:east:2",  // NYG — pick 5
  "sdal:north:3", // CLE — pick 6
]);

async function main() {
  console.log("Creating new SDFL 2026 league with the same 6 human users from SDFL-00102...\n");

  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .insert({
      name: "SDFL 2026 Beta Test",
      is_solo: false,
      league_type: "human",
      status: "waiting",
      owner_user_id: OWNER_USER_ID,
      format_type: "sports_league",
      sports_league_id: "sdfl",
      sports_standings_season: 2026,
      player_count: PLAYER_COUNT,
      visibility: "public",
      opponent_type: "mixed",
      draft_order_method: "random_shuffle",
      scoring_mode: "percent_gain",
      draft_format: "live",
      pick_time_seconds: 30,
    })
    .select("id, support_code")
    .single();

  if (leagueError || !league) {
    console.error("League creation failed:", leagueError?.message);
    process.exit(1);
  }

  const leagueId = league.id;
  console.log(`League created: ${leagueId} (support code: ${league.support_code ?? "n/a"})`);

  for (let i = 0; i < HUMAN_USER_IDS.length; i++) {
    const { error } = await supabase.from("league_members").insert({
      league_id: leagueId,
      user_id: HUMAN_USER_IDS[i],
      display_name: "Pending",
      draft_slot: i,
    });
    if (error) {
      console.error(`Failed to add human ${HUMAN_USER_IDS[i]}:`, error.message);
      process.exit(1);
    }
  }
  console.log(`Added ${HUMAN_USER_IDS.length} human members (identity not claimed yet — they'll pick in-app).`);

  const { error: draftError } = await supabase
    .from("drafts")
    .insert({ league_id: leagueId, user_id: OWNER_USER_ID });
  if (draftError) {
    console.error("Failed to create drafts row:", draftError.message);
    process.exit(1);
  }

  const claimedSlots = new Set();
  let botsFilled = 0;
  const usedNames = new Set();

  for (let slot = HUMAN_USER_IDS.length; slot < PLAYER_COUNT; slot++) {
    const personality = ALL_BOT_PERSONALITIES[slot % ALL_BOT_PERSONALITIES.length];
    const { data: botId, error: rpcError } = await supabase.rpc("provision_league_bot", {
      p_league_id: leagueId,
      p_display_name: "Pending",
      p_personality: personality,
      p_draft_slot: slot,
      p_bot_config: {},
    });

    if (rpcError || !botId) {
      console.error(`Bot provision failed at slot ${slot}:`, rpcError?.message);
      process.exit(1);
    }

    const openSlot = SDFL_DIVISION_SLOTS.find(
      (s) => !claimedSlots.has(slotKey(s)) && !RESERVED_HUMAN_SLOTS.has(slotKey(s))
    );
    if (!openSlot) {
      console.error("Ran out of SDFL division slots for bots.");
      process.exit(1);
    }
    claimedSlots.add(slotKey(openSlot));

    const city = BOT_CITIES[slot % BOT_CITIES.length];
    let teamName = "";
    for (let offset = 0; offset < BOT_PREFIXES.length && !teamName; offset++) {
      const candidate = `${BOT_PREFIXES[(slot + offset) % BOT_PREFIXES.length]} ${BOT_SUFFIXES[(slot + offset) % BOT_SUFFIXES.length]}`;
      if (!usedNames.has(candidate.toLowerCase())) {
        teamName = candidate;
        usedNames.add(candidate.toLowerCase());
      }
    }
    if (!teamName) teamName = `Metro FC ${slot + 1}`;
    const colors = BOT_COLOR_PAIRS[slot % BOT_COLOR_PAIRS.length];

    const { error: identityError } = await supabase
      .from("league_members")
      .update({
        conference: openSlot.conference,
        division: openSlot.division,
        division_slot: openSlot.divisionSlot,
        franchise_city: city,
        franchise_colors: colors,
        display_name: teamName,
        identity_completed_at: new Date().toISOString(),
      })
      .eq("league_id", leagueId)
      .eq("user_id", botId);

    if (identityError) {
      console.error(`Bot identity assignment failed at slot ${slot}:`, identityError.message);
      process.exit(1);
    }

    botsFilled++;
  }

  console.log(`Filled ${botsFilled} bot slots with identities assigned.`);
  console.log(
    `\nOnly the 6 slots mapping to LV/NYJ/ARI/TEN/NYG/CLE (original picks 1-6) remain open — ` +
      `whichever human claims which, all 6 will draft first, back-to-back, no bots in between.`
  );
  console.log(`League ID: ${leagueId}`);
  console.log(`Support code: ${league.support_code ?? "(check leagues table)"}`);
}

main();
