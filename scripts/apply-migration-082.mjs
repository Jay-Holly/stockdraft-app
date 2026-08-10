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
const sqlPath = path.join(process.cwd(), "supabase/migrations/082_retire_sdpl2.sql");

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
    // Refuse to tighten the constraint if a 2-team league somehow still exists.
    const { rows: legacy } = await client.query(
      `select id, support_code from public.leagues where player_count = 2`
    );
    if (legacy.length > 0) {
      console.error("Aborting — 2-team leagues still present:");
      console.table(legacy);
      process.exit(1);
    }

    await client.query(sql);
    console.log("Migration 082 applied.");

    const { rows } = await client.query(
      `select pg_get_constraintdef(oid) as definition
         from pg_constraint
        where conname = 'leagues_player_count_check'`
    );
    console.table(rows);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
