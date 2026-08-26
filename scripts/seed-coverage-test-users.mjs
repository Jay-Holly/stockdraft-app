#!/usr/bin/env node
/**
 * Creates 80 fake QA accounts and enters each into today's $2 SDDFS contest
 * with a lineup built to prioritize symbols never picked in any prior SDDFS
 * entry — 80 is the fewest lineups that can fully exhaust Industrials, the
 * largest draft-pool sector, so this run also cycles every sector and the
 * whole crypto pool through at least once.
 *
 * Each account: auth user (email under a .test domain, non-routable, clearly
 * a fake), identity marked verified with the same fingerprint the existing
 * QA accounts use (dob 1990-01-01, state PA), and a $50 "QA test balance"
 * deposit — enough for the $2 entry fee with room to spare.
 *
 * Entries go through the real enter_sddfs_contest RPC (migration 088), same
 * as production traffic — this is also further live exercise of that path.
 *
 * Cleanup: scripts/cleanup-test-users.sql already exists for bulk-removing
 * test accounts while preserving one named account; these new users are
 * ordinary auth.users rows and fall inside its scope.
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

const USER_COUNT = 80;
const CONTEST_DATE = "2026-08-19";
const TARGET_BUY_IN = 2;
const DEPOSIT_AMOUNT = 50;

async function main() {
  const { data: pool } = await supabase
    .from("draft_pool")
    .select("symbol, sector")
    .order("symbol");
  const { data: coins } = await supabase
    .from("crypto_pool")
    .select("symbol")
    .order("symbol");

  const { data: usedPicks } = await supabase
    .from("sddfs_entry_picks")
    .select("symbol");
  const everUsed = new Set((usedPicks ?? []).map((p) => p.symbol.toUpperCase()));

  const sectors = [...new Set(pool.map((p) => p.sector))];
  console.log(`Pool: ${pool.length} stocks across ${sectors.length} sectors, ${coins.length} coins`);
  console.log(`Historically picked (any date): ${everUsed.size} distinct symbols\n`);

  // Unused-first ordering per sector, then crypto — so the first pass through
  // each list favors symbols with zero prior appearances.
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

  const lineups = [];
  for (let i = 0; i < USER_COUNT; i++) {
    const picks = [];
    for (const sector of sectors) {
      const list = bySector.get(sector);
      picks.push({ sector, symbol: list[i % list.length] });
    }
    picks.push({ sector: "Crypto", symbol: cryptoOrdered[i % cryptoOrdered.length] });
    lineups.push(picks);
  }

  const { data: contests } = await supabase
    .from("sddfs_contests")
    .select("id, buy_in")
    .eq("contest_date", CONTEST_DATE);
  const contest = (contests ?? []).find((c) => Number(c.buy_in) === TARGET_BUY_IN);
  if (!contest) throw new Error(`No $${TARGET_BUY_IN} contest found for ${CONTEST_DATE}`);
  console.log(`Target contest: $${TARGET_BUY_IN} on ${CONTEST_DATE} (${contest.id})\n`);

  let created = 0;
  let entered = 0;
  const failures = [];

  for (let i = 0; i < USER_COUNT; i++) {
    const n = String(i + 1).padStart(3, "0");
    const email = `dfs-coverage-${n}@qatest.stockduel.test`;
    const username = `coverage_${n}`;

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
      {
        user_id: uid,
        identity_status: "verified",
        date_of_birth: "1990-01-01",
        state: "PA",
        updated_at: new Date().toISOString(),
      },
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
      p_picks: lineups[i],
    });
    if (entryError || !entryId) {
      failures.push(`${email}: entry - ${entryError?.message}`);
      continue;
    }
    entered++;
  }

  console.log(`Accounts created: ${created}/${USER_COUNT}`);
  console.log(`Entries placed:   ${entered}/${USER_COUNT}`);
  if (failures.length) {
    console.log(`\nFailures (${failures.length}):`);
    failures.forEach((f) => console.log(`  ${f}`));
  }

  // Verify actual coverage.
  const { data: allEntries } = await supabase
    .from("sddfs_entries")
    .select("id")
    .eq("contest_id", contest.id);
  const { data: allPicks } = await supabase
    .from("sddfs_entry_picks")
    .select("symbol, sector")
    .in("entry_id", (allEntries ?? []).map((e) => e.id));

  const coveredStocks = new Set(
    (allPicks ?? []).filter((p) => p.sector !== "Crypto").map((p) => p.symbol.toUpperCase())
  );
  const coveredCrypto = new Set(
    (allPicks ?? []).filter((p) => p.sector === "Crypto").map((p) => p.symbol.toUpperCase())
  );

  console.log(`\nStock symbols covered in this contest: ${coveredStocks.size} / ${pool.length}`);
  console.log(`Crypto symbols covered in this contest:  ${coveredCrypto.size} / ${coins.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
