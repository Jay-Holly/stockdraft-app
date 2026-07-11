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
const sqlPath = path.join(process.cwd(), "supabase/migrations/057_dedupe_and_lock_draft_picks.sql");

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
    const before = await client.query(`
      select count(*) as cnt from (
        select draft_id, pick_order
        from public.draft_picks
        group by draft_id, pick_order
        having count(*) > 1
      ) dupes
    `);
    console.log("Duplicate (draft_id, pick_order) slots before:", before.rows[0].cnt);

    await client.query(sql);

    const after = await client.query(`
      select count(*) as cnt from (
        select draft_id, pick_order
        from public.draft_picks
        group by draft_id, pick_order
        having count(*) > 1
      ) dupes
    `);
    console.log("Duplicate (draft_id, pick_order) slots after:", after.rows[0].cnt);

    const { rows } = await client.query(`
      select pg_get_constraintdef(oid) as def
      from pg_constraint
      where conrelid = 'public.draft_picks'::regclass
        and conname = 'draft_picks_draft_id_pick_order_key'
    `);
    console.log("Migration 057 applied.");
    console.log("draft_picks_draft_id_pick_order_key:", rows[0]?.def);
  } finally {
    await client.end();
  }
}
main().catch((err) => { console.error(err); process.exit(1); });
