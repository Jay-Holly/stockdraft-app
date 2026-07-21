#!/usr/bin/env node
// Finds every team that appears in 2+ sim_game_results rows on the same
// real game_date for nba/nhl 2024 season — physically impossible, so at
// least one row per group is wrong. Prints them for manual ESPN re-check.
import fs from "node:fs";
import path from "node:path";

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
const dbUrl = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL ?? process.env.POSTGRES_URL;

async function main() {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  for (const sport of ["nba", "nhl"]) {
    console.log(`\n=== ${sport} ===`);
    const { rows } = await client.query(
      `select id, game_date, home_team, away_team from sim_game_results where sport=$1 and season='2024' order by game_date`,
      [sport]
    );

    const byTeamDate = new Map(); // team -> date -> [rows]
    for (const r of rows) {
      const date = r.game_date.toISOString().slice(0, 10);
      for (const team of [r.home_team, r.away_team]) {
        const key = `${team}|${date}`;
        if (!byTeamDate.has(key)) byTeamDate.set(key, []);
        byTeamDate.get(key).push(r);
      }
    }

    for (const [key, group] of byTeamDate) {
      if (group.length < 2) continue;
      const uniqueIds = new Set(group.map((r) => r.id));
      if (uniqueIds.size < 2) continue; // same row counted twice (shouldn't happen)
      const [team, date] = key.split("|");
      console.log(`${team} double-booked on ${date}:`);
      for (const r of group) {
        console.log(`   id=${r.id} ${r.home_team} vs ${r.away_team}`);
      }
    }
  }

  await client.end();
}

main();
