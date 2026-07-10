#!/usr/bin/env node
/**
 * Apply migration 055 (SDFL real-schedule constraints) via direct Postgres.
 *
 * Usage:
 *   SUPABASE_DB_URL='postgresql://postgres.[ref]:[password]@...pooler.supabase.com:6543/postgres' \
 *     node scripts/apply-migration-055.mjs
 *
 * Get the connection string from Supabase Dashboard -> Project Settings -> Database.
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
    const value = line.slice(index + 1).replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.join(process.cwd(), ".env.local"));

const dbUrl =
  process.env.SUPABASE_DB_URL ??
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL;

const sqlPath = path.join(
  process.cwd(),
  "supabase/migrations/055_sdfl_real_schedule.sql"
);

async function main() {
  if (!dbUrl) {
    console.error(
      "Missing SUPABASE_DB_URL (or DATABASE_URL). Paste the Postgres connection string from Supabase Dashboard -> Database -> Connection string (Session pooler)."
    );
    process.exit(1);
  }

  const { default: pg } = await import("pg");
  const sql = fs.readFileSync(sqlPath, "utf8");
  const client = new pg.Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    await client.query(sql);

    const { rows: weekConstraint } = await client.query(`
      select pg_get_constraintdef(oid) as def
      from pg_constraint
      where conrelid = 'public.leagues'::regclass
        and conname = 'leagues_current_week_check'
    `);
    const { rows: playoffConstraint } = await client.query(`
      select pg_get_constraintdef(oid) as def
      from pg_constraint
      where conrelid = 'public.league_matchups'::regclass
        and conname = 'league_matchups_playoff_round_check'
    `);

    console.log("Migration 055 applied.");
    console.log("leagues_current_week_check:", weekConstraint[0]?.def);
    console.log(
      "league_matchups_playoff_round_check:",
      playoffConstraint[0]?.def
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
