#!/usr/bin/env node
// Deletes exact-duplicate sim_game_results rows for MLB 2024 (same
// game_date+home_team+away_team inserted more than once by the original
// seed script), keeping the lowest id per group. Dry-run by default; pass
// --execute to actually delete.
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
const execute = process.argv.includes("--execute");

async function main() {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const { rows: toDelete } = await client.query(`
    select id from sim_game_results g
    where sport = 'mlb' and season = '2024'
    and id not in (
      select min(id) from sim_game_results
      where sport = 'mlb' and season = '2024'
      group by game_date, home_team, away_team
    )
  `);

  console.log(`Found ${toDelete.length} duplicate rows to delete.`);
  if (toDelete.length > 0) {
    console.log("Sample ids:", toDelete.slice(0, 10).map((r) => r.id));
  }

  if (!execute) {
    console.log("Dry run only — pass --execute to actually delete.");
    await client.end();
    return;
  }

  const ids = toDelete.map((r) => r.id);
  const { rowCount } = await client.query(
    `delete from sim_game_results where id = any($1::bigint[])`,
    [ids]
  );
  console.log(`Deleted ${rowCount} rows.`);

  const { rows: check } = await client.query(`
    select game_date, home_team, away_team, count(*) c
    from sim_game_results
    where sport='mlb' and season='2024'
    group by game_date, home_team, away_team
    having count(*) > 1
  `);
  console.log(`Remaining duplicate groups: ${check.length}`);

  await client.end();
}

main();
