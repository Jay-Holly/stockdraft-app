#!/usr/bin/env node
/**
 * Fills tomorrow's $2 SDDFS contest to its 150-team max: enters the 80
 * existing dfs-coverage-* QA accounts, then creates 70 new ones
 * (dfs-coverage-081..150) the same way seed-coverage-test-users.mjs does,
 * to reach 150 total.
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

const CONTEST_DATE = "2026-09-03";
const TARGET_BUY_IN = 2;
const TARGET_TOTAL = 150;
const DEPOSIT_AMOUNT = 50;

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
  console.log(`Already entered: ${alreadyEntered.size}`);

  const existingQa = JSON.parse(fs.readFileSync("scripts/.qa-coverage-user-ids.json", "utf8"));
  console.log(`Existing QA accounts on file: ${existingQa.length}`);

  let entered = 0;
  let created = 0;
  const failures = [];
  let i = 0;

  // Pass 1: enter existing accounts not yet in this contest.
  for (const { id: uid, email } of existingQa) {
    if (alreadyEntered.size + entered >= TARGET_TOTAL) break;
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
    entered++;
  }

  // Pass 2: create new accounts numbered right after the existing set to
  // make up the remainder.
  let nextNum = existingQa.length + 1;
  while (alreadyEntered.size + entered < TARGET_TOTAL) {
    const n = String(nextNum).padStart(3, "0");
    const email = `dfs-coverage-${n}@qatest.stockduel.test`;
    const username = `coverage_${n}`;
    nextNum++;

    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { username, team_name: `Coverage Test ${n}` },
    });
    if (authError || !authUser?.user) {
      failures.push(`${email}: createUser failed - ${authError?.message}`);
      continue;
    }
    const uid = authUser.user.id;
    created++;

    const { error: identityError } = await supabase.from("profile_identity").upsert(
      { user_id: uid, identity_status: "verified", date_of_birth: "1990-01-01", state: "PA", updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
    if (identityError) failures.push(`${email}: identity - ${identityError.message}`);

    const { error: depositError } = await supabase.from("wallet_transactions").insert({
      user_id: uid,
      type: "deposit",
      amount: DEPOSIT_AMOUNT,
      status: "completed",
      description: "QA test balance — beta testing, not a real deposit",
    });
    if (depositError) failures.push(`${email}: deposit - ${depositError.message}`);

    const { data: entryId, error: entryError } = await supabase.rpc("enter_sddfs_contest", {
      p_contest_id: contest.id,
      p_user_id: uid,
      p_picks: lineupFor(i++),
    });
    if (entryError || !entryId) {
      failures.push(`${email}: entry - ${entryError?.message}`);
      continue;
    }
    entered++;
  }

  console.log(`\nNew accounts created: ${created}`);
  console.log(`New entries placed:   ${entered}`);
  if (failures.length) {
    console.log(`\nFailures (${failures.length}):`);
    failures.forEach((f) => console.log(`  ${f}`));
  }

  const { data: allEntries } = await supabase.from("sddfs_entries").select("id").eq("contest_id", contest.id);
  console.log(`\nFinal: ${allEntries?.length ?? 0}/${TARGET_TOTAL} entries in $${TARGET_BUY_IN} contest ${contest.id}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
