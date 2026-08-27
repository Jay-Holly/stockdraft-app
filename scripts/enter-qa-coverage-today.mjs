#!/usr/bin/env node
/**
 * Enters the 80 existing dfs-coverage-* QA accounts into TODAY's $2 SDDFS
 * contest, cycling lineups across every sector and the crypto pool for
 * broad symbol coverage — same lineup-construction approach as
 * seed-coverage-test-users.mjs, but against accounts that already exist
 * rather than creating new ones.
 *
 * Funds a top-up deposit only for an account whose balance is too low for
 * the entry fee; existing balance from prior days is reused otherwise.
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

const TARGET_BUY_IN = 2;
const TOPUP_AMOUNT = 50;

function todayIso() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

async function main() {
  const users = JSON.parse(fs.readFileSync("scripts/.qa-coverage-user-ids.json", "utf8"));
  console.log(`Loaded ${users.length} existing QA coverage accounts`);

  const CONTEST_DATE = todayIso();

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

  const { data: contests } = await supabase
    .from("sddfs_contests")
    .select("id, buy_in")
    .eq("contest_date", CONTEST_DATE);
  const contest = (contests ?? []).find((c) => Number(c.buy_in) === TARGET_BUY_IN);
  if (!contest) throw new Error(`No $${TARGET_BUY_IN} contest found for ${CONTEST_DATE}`);
  console.log(`Target contest: $${TARGET_BUY_IN} on ${CONTEST_DATE} (${contest.id})`);

  const { data: existingEntries } = await supabase
    .from("sddfs_entries")
    .select("id, user_id")
    .eq("contest_id", contest.id);
  const alreadyEntered = new Set((existingEntries ?? []).map((e) => e.user_id));
  console.log(`Already entered: ${alreadyEntered.size}/${users.length}`);

  let entered = 0;
  let toppedUp = 0;
  const failures = [];

  for (let i = 0; i < users.length; i++) {
    const { id: uid, email } = users[i];
    if (alreadyEntered.has(uid)) continue;

    const picks = [];
    for (const sector of sectors) {
      const list = bySector.get(sector);
      picks.push({ sector, symbol: list[i % list.length] });
    }
    picks.push({ sector: "Crypto", symbol: cryptoOrdered[i % cryptoOrdered.length] });

    let { data: entryId, error: entryError } = await supabase.rpc("enter_sddfs_contest", {
      p_contest_id: contest.id,
      p_user_id: uid,
      p_picks: picks,
    });

    if (entryError && /balance|insufficient|fund/i.test(entryError.message ?? "")) {
      const { error: depositError } = await supabase.from("wallet_transactions").insert({
        user_id: uid,
        type: "deposit",
        amount: TOPUP_AMOUNT,
        status: "completed",
        description: "QA test balance — beta testing, not a real deposit",
      });
      if (depositError) {
        failures.push(`${email}: topup failed - ${depositError.message}`);
        continue;
      }
      toppedUp++;
      ({ data: entryId, error: entryError } = await supabase.rpc("enter_sddfs_contest", {
        p_contest_id: contest.id,
        p_user_id: uid,
        p_picks: picks,
      }));
    }

    if (entryError || !entryId) {
      failures.push(`${email}: ${entryError?.message ?? "no entry id returned"}`);
      continue;
    }
    entered++;
  }

  console.log(`\nEntered: ${entered}, topped up: ${toppedUp}, already had entries: ${alreadyEntered.size}`);
  if (failures.length) {
    console.log(`Failures (${failures.length}):`);
    failures.forEach((f) => console.log(`  ${f}`));
  }

  const { data: allEntries } = await supabase
    .from("sddfs_entries")
    .select("id")
    .eq("contest_id", contest.id);
  const { data: allPicks } = await supabase
    .from("sddfs_entry_picks")
    .select("id")
    .in("entry_id", (allEntries ?? []).map((e) => e.id));
  console.log(`\nFinal: ${allEntries?.length ?? 0} entries, ${allPicks?.length ?? 0} picks in $${TARGET_BUY_IN} contest ${contest.id}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
