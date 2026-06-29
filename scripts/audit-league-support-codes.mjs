#!/usr/bin/env node
/**
 * Audit league support_code prefixes vs expected scheme.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/audit-league-support-codes.mjs
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/audit-league-support-codes.mjs --ai-only
 *
 * Loads .env.local when present.
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
const aiOnly = process.argv.includes("--ai-only");

if (!url || !serviceKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Run scripts/audit-league-support-codes.sql or audit-ai-league-support-codes.sql in Supabase SQL Editor."
  );
  process.exit(1);
}

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
};

/** Check order: ai → sports → standard SDPL */
function expectedPrefix(league) {
  if (league.league_type === "ai") {
    return "SDAI";
  }
  if (league.format_type === "sports_league" && league.sports_league_id) {
    return league.sports_league_id.toUpperCase();
  }
  if (
    league.format_type === "standard" &&
    [2, 4, 6, 8, 10, 12].includes(league.player_count)
  ) {
    return `SDPL${league.player_count}`;
  }
  return "SDPL4";
}

function parseSupportCode(code) {
  const dash = code.indexOf("-");
  if (dash === -1) return { prefix: code.toUpperCase(), suffix: "" };
  return {
    prefix: code.slice(0, dash).toUpperCase(),
    suffix: code.slice(dash + 1),
  };
}

async function main() {
  let endpoint = `${url}/rest/v1/leagues?select=id,name,support_code,league_type,format_type,sports_league_id,player_count,visibility,opponent_type,status,is_solo,created_at&order=created_at.asc`;
  if (aiOnly) {
    endpoint += "&league_type=eq.ai";
  }

  const res = await fetch(endpoint, { headers });

  if (!res.ok) {
    console.error(await res.text());
    process.exit(1);
  }

  const leagues = await res.json();
  const mismatched = [];
  const matched = [];

  for (const league of leagues) {
    const { prefix: currentPrefix, suffix } = parseSupportCode(league.support_code);
    const expected = expectedPrefix(league);
    const expectedCode = `${expected}-${suffix}`;
    const row = {
      current_support_code: league.support_code,
      expected_support_code: expectedCode,
      current_prefix: currentPrefix,
      expected_prefix: expected,
      numeric_suffix: suffix,
      league_type: league.league_type,
      format_type: league.format_type,
      sports_league_id: league.sports_league_id,
      player_count: league.player_count,
      status: league.status,
      name: league.name,
      id: league.id,
      created_at: league.created_at,
    };

    if (currentPrefix !== expected) {
      mismatched.push(row);
    } else {
      matched.push(row);
    }
  }

  console.log(aiOnly ? "AI leagues audit" : "All leagues audit");
  console.log(`Total leagues: ${leagues.length}`);
  console.log(`Matched prefix: ${matched.length}`);
  console.log(`Mismatched: ${mismatched.length}\n`);

  if (mismatched.length === 0) {
    console.log("No mismatched leagues.");
    return;
  }

  console.table(
    mismatched.map((row) => ({
      current: row.current_support_code,
      expected: row.expected_support_code,
      type: row.league_type,
      format: row.format_type,
      players: row.player_count,
      status: row.status,
      name: row.name,
    }))
  );

  console.log("\nFull JSON:\n", JSON.stringify(mismatched, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
