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
async function main() {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    for (const table of ["sddfs_contests", "sdwfs_contests"]) {
      const { rows } = await client.query(
        `select column_name, data_type from information_schema.columns where table_name = $1 order by ordinal_position`,
        [table]
      );
      console.log(table, rows);
    }
  } finally {
    await client.end();
  }
}
main();
