/**
 * Read-only investigation of duplicate draft_picks / league_draft_events rows
 * for SDFL-00063 (bot auto-pick race condition).
 * Run: node scripts/investigate-sdfl-00063-dupes.mjs
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

const LEAGUE_ID = "20016a9c-7b8d-4831-b00c-4137ac4cbe25";

async function main() {
  const { data: allDrafts, error: draftsErr } = await supabase
    .from("drafts")
    .select("id, user_id")
    .eq("league_id", LEAGUE_ID);
  if (draftsErr) throw draftsErr;
  const draftByUser = new Map(allDrafts.map((d) => [d.user_id, d.id]));
  const draftIds = allDrafts.map((d) => d.id);

  const { data: picks, error: picksErr } = await supabase
    .from("draft_picks")
    .select(
      "id, draft_id, user_id, round_number, pick_order, pick_type, symbol, is_auto_pick, auto_pick_reason, created_at, global_pick_number"
    )
    .in("draft_id", draftIds);
  if (picksErr) throw picksErr;

  // Duplicate slots per draft: same draft_id + pick_order appearing more than once.
  const byDraftOrder = new Map();
  for (const p of picks) {
    const key = `${p.draft_id}:${p.pick_order}`;
    if (!byDraftOrder.has(key)) byDraftOrder.set(key, []);
    byDraftOrder.get(key).push(p);
  }
  const dupSlots = [...byDraftOrder.entries()].filter(([, rows]) => rows.length > 1);

  console.log(
    `League ${LEAGUE_ID}: ${draftIds.length} drafts, ${picks.length} total draft_picks rows, ${dupSlots.length} duplicate (draft_id, pick_order) slots`
  );
  for (const [key, rows] of dupSlots) {
    console.log(
      `  ${key}:`,
      rows
        .map(
          (r) =>
            `id=${r.id} round=${r.round_number} sym=${r.symbol} type=${r.pick_type} auto=${r.auto_pick_reason} created=${r.created_at}`
        )
        .join(" | ")
    );
  }

  const { data: events, error: evErr } = await supabase
    .from("league_draft_events")
    .select("global_pick_number, user_id, symbol, round_number, id, created_at")
    .eq("league_id", LEAGUE_ID)
    .order("global_pick_number", { ascending: true });
  if (evErr) throw evErr;

  const byGpn = new Map();
  for (const e of events) {
    if (!byGpn.has(e.global_pick_number)) byGpn.set(e.global_pick_number, []);
    byGpn.get(e.global_pick_number).push(e);
  }
  const dupGpn = [...byGpn.entries()].filter(([, rows]) => rows.length > 1);
  console.log(
    `\nLeague ${LEAGUE_ID}: ${events.length} total events, ${dupGpn.length} duplicate global_pick_number slots`
  );

  let realDupCount = 0;
  const summary = [];
  for (const [gpn, rows] of dupGpn) {
    const details = [];
    let anyRealDup = false;
    for (const e of rows) {
      const did = draftByUser.get(e.user_id);
      const matchingPicks = picks.filter(
        (p) => p.draft_id === did && p.round_number === e.round_number && p.symbol === e.symbol
      );
      if (matchingPicks.length > 1) anyRealDup = true;
      details.push(
        `user=${e.user_id} round=${e.round_number} sym=${e.symbol} matchingDraftPicksRows=${matchingPicks.length}`
      );
    }
    if (anyRealDup) realDupCount++;
    summary.push(`gpn=${gpn}: ${details.join(" || ")}`);
  }
  console.log(summary.join("\n"));
  console.log(
    `\n${realDupCount} of ${dupGpn.length} duplicate event slots correspond to a real duplicate draft_picks row (>1 pick with same round+symbol for that user's draft)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
