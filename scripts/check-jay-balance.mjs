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
const dbUrl = process.env.SUPABASE_DB_URL;
const userId = "534054c5-6789-47db-8241-d0549b4541db";

async function main() {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const { rows: sddfsCols } = await client.query(
      `select column_name, data_type from information_schema.columns where table_name = 'sddfs_entries' order by ordinal_position`
    );
    console.log("sddfs_entries columns:", sddfsCols);

    const { rows: sdwfsCols } = await client.query(
      `select column_name, data_type from information_schema.columns where table_name = 'sdwfs_entries' order by ordinal_position`
    );
    console.log("sdwfs_entries columns:", sdwfsCols);

    const { rows: sddfsEntries } = await client.query(
      `select * from public.sddfs_entries where user_id = $1`,
      [userId]
    );
    console.log("Jay's SDDFS entries:", sddfsEntries);

    const { rows: sdwfsEntries } = await client.query(
      `select * from public.sdwfs_entries where user_id = $1`,
      [userId]
    );
    console.log("Jay's SDWFS entries:", sdwfsEntries);

    const { rows: txns } = await client.query(
      `select id, type, amount, status, description, created_at from public.wallet_transactions where user_id = $1 order by created_at desc`,
      [userId]
    );
    console.log("Wallet transactions:", txns);

    const balance = txns
      .filter((t) => ["completed", "pending"].includes(t.status))
      .reduce((sum, t) => sum + Number(t.amount), 0);
    console.log("Computed balance:", balance);
  } finally {
    await client.end();
  }
}
main();
