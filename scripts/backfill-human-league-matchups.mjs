#!/usr/bin/env node
/**
 * Backfill missing human-league matchup schedules by league UUID.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-human-league-matchups.mjs
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-human-league-matchups.mjs <league-uuid> ...
 *
 * Prefers RPC backfill_human_league_matchups_by_id (migration 041).
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */

import fs from "node:fs";
import path from "node:path";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    const key = line.slice(0, index);
    const value = line.slice(index + 1);
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.join(process.cwd(), ".env.local"));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const DEFAULT_LEAGUE_IDS = [
  "cf0b58c3-b7df-4478-aa5f-0871cb021bfe", // SDPL2-00022
  "7c7962ba-3a4b-461f-a739-0a785eee8a3e", // SDPL2-00024
];

if (!url || !serviceKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY."
  );
  process.exit(1);
}

const leagueIds =
  process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_LEAGUE_IDS;

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  "Content-Type": "application/json",
};

async function backfillLeague(leagueId) {
  const res = await fetch(`${url}/rest/v1/rpc/backfill_human_league_matchups_by_id`, {
    method: "POST",
    headers,
    body: JSON.stringify({ p_league_id: leagueId }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`RPC failed for ${leagueId}: ${text}`);
  }

  return JSON.parse(text);
}

async function main() {
  const results = [];

  for (const leagueId of leagueIds) {
    try {
      const rows = await backfillLeague(leagueId);
      const result = rows[0] ?? rows;
      console.log(`\n${leagueId}:`, result);
      results.push({ leagueId, ...result });
    } catch (err) {
      console.error(String(err));
      results.push({ leagueId, seeded: false, error: String(err) });
    }
  }

  console.log("\nSummary:", JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
