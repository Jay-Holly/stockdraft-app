#!/usr/bin/env node
/**
 * Fills every SDDFS tier for tomorrow's contest_date to its max_entrants,
 * using the 150 existing dfs-coverage-* QA accounts (reused across tiers,
 * since entries are scoped per contest), and enters Jay's own account into
 * every single tier so he can watch each one live.
 */
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

const CONTEST_DATE = "2026-09-04";
const JAY_USER_ID = "534054c5-6789-47db-8241-d0549b4541db";

async function main() {
  const { data: pool } = await supabase.from("draft_pool").select("symbol, sector").order("symbol");
  const { data: coins } = await supabase.from("crypto_pool").select("symbol").order("symbol");
  const { data: usedPicks } = await supabase.from("sddfs_entry_picks").select("symbol");
  const everUsed = new Set((usedPicks ?? []).map((p) => p.symbol.toUpperCase()));

  const sectors = [...new Set(pool.map((p) => p.sector))];
  function orderedSymbols(symbols) {
    const unused = symbols.filter((s) => !everUsed.has(s.toUpperCase()));
    const used = symbols.filter((s) => everUsed.has(s.toUpperCase()));
    return [...unused, ...used];
  }
  const bySector = new Map();
  for (const sector of sectors) {
    const symbols = pool.filter((p) => p.sector === sector).map((p) => p.symbol);
    bySector.set(sector, orderedSymbols(symbols));
  }
  const cryptoOrdered = orderedSymbols(coins.map((c) => c.symbol));

  function lineupFor(i) {
    const picks = [];
    for (const sector of sectors) {
      const list = bySector.get(sector);
      picks.push({ sector, symbol: list[i % list.length] });
    }
    picks.push({ sector: "Crypto", symbol: cryptoOrdered[i % cryptoOrdered.length] });
    return picks;
  }

  const qaAccounts = JSON.parse(fs.readFileSync("scripts/.qa-coverage-user-ids.json", "utf8"));
  console.log(`QA accounts available: ${qaAccounts.length}`);

  const { data: contests } = await supabase
    .from("sddfs_contests")
    .select("id, buy_in, max_entrants")
    .eq("contest_date", CONTEST_DATE)
    .order("buy_in", { ascending: true });
  console.log(`Contests found: ${contests.length}\n`);

  for (const contest of contests) {
    console.log(`--- $${contest.buy_in} contest (max ${contest.max_entrants}) ---`);

    const { data: existingEntries } = await supabase
      .from("sddfs_entries")
      .select("id, user_id")
      .eq("contest_id", contest.id);
    const alreadyEntered = new Set((existingEntries ?? []).map((e) => e.user_id));
    console.log(`Already entered: ${alreadyEntered.size}`);

    let i = 0;
    let entered = 0;
    const failures = [];

    // Jay first, if not already in.
    if (!alreadyEntered.has(JAY_USER_ID)) {
      const { data: entryId, error } = await supabase.rpc("enter_sddfs_contest", {
        p_contest_id: contest.id,
        p_user_id: JAY_USER_ID,
        p_picks: lineupFor(i++),
      });
      if (error || !entryId) {
        failures.push(`Jay: ${error?.message ?? "no entry id"}`);
      } else {
        alreadyEntered.add(JAY_USER_ID);
        entered++;
        console.log(`Jay entered: ${entryId}`);
      }
    } else {
      console.log("Jay already in this contest.");
    }

    // Fill the rest with QA accounts.
    for (const { id: uid, email } of qaAccounts) {
      if (alreadyEntered.size >= contest.max_entrants) break;
      if (alreadyEntered.has(uid)) continue;

      const { data: entryId, error } = await supabase.rpc("enter_sddfs_contest", {
        p_contest_id: contest.id,
        p_user_id: uid,
        p_picks: lineupFor(i++),
      });
      if (error || !entryId) {
        failures.push(`${email}: ${error?.message ?? "no entry id"}`);
        continue;
      }
      alreadyEntered.add(uid);
      entered++;
    }

    console.log(`New entries this run: ${entered}`);
    if (failures.length) {
      console.log(`Failures (${failures.length}):`);
      failures.forEach((f) => console.log(`  ${f}`));
    }

    const { data: finalEntries } = await supabase
      .from("sddfs_entries")
      .select("id")
      .eq("contest_id", contest.id);
    console.log(`Final: ${finalEntries?.length ?? 0}/${contest.max_entrants}\n`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
