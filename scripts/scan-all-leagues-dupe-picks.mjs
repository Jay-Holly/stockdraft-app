/**
 * Read-only scan across ALL drafts for duplicate (draft_id, pick_order) rows
 * in draft_picks, to gauge blast radius of the auto-pick race condition.
 * Run: node scripts/scan-all-leagues-dupe-picks.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnvLocal();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const pageSize = 1000;
  let from = 0;
  const rows = [];
  for (;;) {
    const { data, error } = await supabase
      .from("draft_picks")
      .select("id, draft_id, pick_order, round_number, symbol, pick_type, auto_pick_reason, is_auto_pick, created_at")
      .range(from, from + pageSize - 1)
      .order("draft_id", { ascending: true });
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  console.log(`Scanned ${rows.length} total draft_picks rows across all drafts`);

  const byDraftOrder = new Map();
  for (const p of rows) {
    const key = `${p.draft_id}:${p.pick_order}`;
    if (!byDraftOrder.has(key)) byDraftOrder.set(key, []);
    byDraftOrder.get(key).push(p);
  }
  const dupSlots = [...byDraftOrder.entries()].filter(([, r]) => r.length > 1);
  const dupDrafts = new Set(dupSlots.map(([k]) => k.split(":")[0]));

  console.log(`${dupSlots.length} duplicate (draft_id, pick_order) slots across ${dupDrafts.size} distinct drafts`);

  const byReason = new Map();
  for (const [, r] of dupSlots) {
    for (const row of r) {
      const reason = row.auto_pick_reason ?? (row.is_auto_pick ? "auto(no-reason)" : "manual");
      byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
    }
  }
  console.log("Duplicate rows by auto_pick_reason:", Object.fromEntries(byReason));

  if (dupDrafts.size > 0) {
    const { data: draftMeta } = await supabase
      .from("drafts")
      .select("id, league_id")
      .in("id", [...dupDrafts]);
    const leagueIds = new Set((draftMeta ?? []).map((d) => d.league_id));
    console.log(`Affects ${leagueIds.size} distinct leagues`);

    const { data: leagueRows } = await supabase
      .from("leagues")
      .select("id, name")
      .in("id", [...leagueIds]);
    console.log("Leagues:", (leagueRows ?? []).map((l) => `${l.name ?? l.id}`).join(", "));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
