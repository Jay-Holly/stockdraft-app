#!/usr/bin/env node
/**
 * Apply migration 050 (human league delete RLS) via direct Postgres.
 *
 * Usage:
 *   SUPABASE_DB_URL='postgresql://postgres.[ref]:[password]@...pooler.supabase.com:6543/postgres' \
 *     node scripts/apply-migration-050.mjs
 *
 * Get the connection string from Supabase Dashboard → Project Settings → Database.
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
  "supabase/migrations/050_human_league_delete_all_statuses.sql"
);

async function main() {
  if (!dbUrl) {
    console.error(
      "Missing SUPABASE_DB_URL (or DATABASE_URL). Paste the Postgres connection string from Supabase Dashboard → Database → Connection string (Session pooler)."
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
    const { rows } = await client.query(`
      select polname
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'leagues'
        and p.polcmd = 'd'
    `);
    console.log("Migration 050 applied.");
    console.log("leagues DELETE policies:", rows.map((r) => r.polname).join(", "));
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
