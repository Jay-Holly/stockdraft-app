#!/usr/bin/env node
/**
 * Apply support_code prefix renames via Supabase REST (3 audited leagues).
 * Trigger fix in 040 still requires running the full SQL migration in Supabase.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/apply-support-code-renames.mjs
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
    const value = line.slice(index + 1);
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.join(process.cwd(), ".env.local"));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RENAMES = [
  {
    id: "5cc1a565-f386-4bba-ab41-7a950ba8fd4d",
    from: "SDFL-00020",
    to: "SDPL2-00020",
  },
  {
    id: "cf0b58c3-b7df-4478-aa5f-0871cb021bfe",
    from: "SDFL-00022",
    to: "SDPL2-00022",
  },
  {
    id: "7c7962ba-3a4b-461f-a739-0a785eee8a3e",
    from: "SDFL-00024",
    to: "SDPL2-00024",
  },
];

async function main() {
  if (!url || !serviceKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };

  for (const row of RENAMES) {
    const res = await fetch(
      `${url}/rest/v1/leagues?id=eq.${row.id}&support_code=eq.${encodeURIComponent(row.from)}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ support_code: row.to }),
      }
    );

    const body = await res.text();
    if (!res.ok) {
      console.error(`Failed ${row.from} → ${row.to}:`, body);
      continue;
    }

    const updated = JSON.parse(body);
    console.log(
      updated.length > 0
        ? `Renamed ${row.from} → ${row.to}`
        : `Skipped ${row.from} (not found or already renamed)`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
