#!/usr/bin/env node
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
const sqlPath = path.join(process.cwd(), "supabase/migrations/056_fast_timer_all_ai.sql");

async function main() {
  if (!dbUrl) {
    console.error("Missing SUPABASE_DB_URL");
    process.exit(1);
  }
  const { default: pg } = await import("pg");
  const sql = fs.readFileSync(sqlPath, "utf8");
  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(sql);
    const { rows } = await client.query(`
      select pg_get_constraintdef(oid) as def
      from pg_constraint
      where conrelid = 'public.leagues'::regclass
        and conname = 'leagues_pick_time_seconds_check'
    `);
    console.log("Migration 056 applied.");
    console.log("leagues_pick_time_seconds_check:", rows[0]?.def);
  } finally {
    await client.end();
  }
}
main().catch((err) => { console.error(err); process.exit(1); });
