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
const sqlPath = path.join(process.cwd(), "supabase/migrations/081_entry_fee_charge_function.sql");

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
    console.log("Migration 081 applied.");
    const { rows } = await client.query(
      `select routine_name from information_schema.routines where routine_name = 'charge_entry_fee'`
    );
    console.table(rows);
  } finally {
    await client.end();
  }
}

main();
