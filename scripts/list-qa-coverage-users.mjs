#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i === -1) continue;
    const k = line.slice(0, i);
    const v = line.slice(i + 1).replace(/^["']|["']$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnvFile(path.join(process.cwd(), ".env.local"));

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  let all = [];
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    all = all.concat(data.users);
    if (data.users.length < 200) break;
    page++;
  }
  const qa = all.filter(
    (u) => u.email && u.email.includes("dfs-coverage-") && u.email.includes("qatest.stockduel.test")
  );
  console.log(`Found ${qa.length} dfs-coverage-* accounts`);
  fs.writeFileSync(
    "scripts/.qa-coverage-user-ids.json",
    JSON.stringify(qa.map((u) => ({ id: u.id, email: u.email })).sort((a, b) => a.email.localeCompare(b.email)), null, 2)
  );
  console.log("Wrote scripts/.qa-coverage-user-ids.json");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
