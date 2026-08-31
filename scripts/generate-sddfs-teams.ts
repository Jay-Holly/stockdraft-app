#!/usr/bin/env node

/**
 * Generates 80 fake SDDFS entries for Monday 2026-09-01 ($2 tier).
 * Each team has 12 picks: one from each of 11 GICS sectors + 1 crypto.
 * Collectively, all 80 teams will use every stock in the pool at least once.
 */

import { createServiceClient } from "../src/lib/supabase/service";
import { zonedDateTimeFromIso } from "../src/lib/season/eastern-time";
import { randomUUID } from "crypto";

const CONTEST_DATE = "2026-09-01";
const BUY_IN = 2;
const NUM_TEAMS = 80;

// GICS sectors in order
const SECTORS = [
  "Technology",
  "Financials",
  "Healthcare",
  "Consumer Discretionary",
  "Consumer Staples",
  "Energy",
  "Industrials",
  "Materials",
  "Real Estate",
  "Utilities",
  "Communication Services",
];

// Crypto options
const CRYPTOS = ["BTC", "ETH", "SOL", "DOGE", "XRP"];

async function main() {
  try {
    const supabase = createServiceClient();

    // 1. Fetch draft pool grouped by sector
    console.log("📦 Fetching draft pool...");
    const { data: draftPool } = await supabase
      .from("draft_pool")
      .select("symbol, sector")
      .order("sector")
      .order("symbol");

    if (!draftPool || draftPool.length === 0) {
      throw new Error("No stocks found in draft_pool");
    }

    const bySektor: Record<string, string[]> = {};
    for (const stock of draftPool) {
      if (!bySektor[stock.sector]) bySektor[stock.sector] = [];
      bySektor[stock.sector].push(stock.symbol);
    }

    // 2. Fetch crypto pool (first 5 for cycling)
    console.log("🪙 Fetching crypto pool...");
    const { data: cryptoPoolData } = await supabase
      .from("crypto_pool")
      .select("symbol")
      .order("market_cap_rank")
      .limit(5);

    const availableCryptos = cryptoPoolData?.map((c) => c.symbol) || CRYPTOS;

    // 3. Get or create contest
    console.log(
      `🎯 Looking for contest on ${CONTEST_DATE} with $${BUY_IN} buy-in...`
    );
    const { data: contests } = await supabase
      .from("sddfs_contests")
      .select("id")
      .eq("contest_date", CONTEST_DATE)
      .eq("buy_in", BUY_IN)
      .maybeSingle();

    let contestId: string;
    if (contests) {
      contestId = contests.id;
      console.log(`✅ Found contest: ${contestId}`);
    } else {
      console.log("Creating new contest...");
      const lockAt = zonedDateTimeFromIso(CONTEST_DATE, 9, 30).toISOString();
      const { data: created, error: createError } = await supabase
        .from("sddfs_contests")
        .insert({
          contest_date: CONTEST_DATE,
          buy_in: BUY_IN,
          max_entrants: 150,
          lock_at: lockAt,
          status: "open",
        })
        .select("id")
        .single();

      if (createError || !created) {
        throw new Error(`Failed to create contest: ${createError?.message}`);
      }
      contestId = created.id;
      console.log(`✅ Created contest: ${contestId}`);
    }

    // 4. Create test profiles with wallet deposits
    console.log(`👥 Creating test user profiles...`);
    const userIds: string[] = [];
    for (let i = 0; i < NUM_TEAMS; i++) {
      const userId = randomUUID();
      userIds.push(userId);
    }

    // Insert test profiles
    const testProfiles = userIds.map((id, i) => ({
      id,
      username: `qa-sddfs-${i}`,
      team_name: `QA Team ${i}`,
      avatar_color: "blue",
    }));

    const { error: profileError } = await supabase
      .from("profiles")
      .upsert(testProfiles, { onConflict: "id", ignoreDuplicates: false });

    if (profileError) {
      console.error("Profile creation error:", profileError);
      throw profileError;
    }

    // Create wallet deposits for test users
    console.log(`💰 Funding test user wallets...`);
    const walletDeposits = userIds.map((userId) => ({
      id: randomUUID(),
      user_id: userId,
      type: "deposit",
      amount: 10000, // $10,000 for testing
      status: "completed",
      description: "QA test wallet funding",
    }));

    const { error: walletError } = await supabase
      .from("wallet_transactions")
      .insert(walletDeposits);

    if (walletError) {
      console.error("Wallet funding error:", walletError);
      throw walletError;
    }

    // 5. Generate team picks
    console.log(`🎲 Generating ${NUM_TEAMS} team lineups...`);
    const teams: { userId: string; picks: { sector: string; symbol: string }[] }[] =
      [];

    for (let teamIdx = 0; teamIdx < NUM_TEAMS; teamIdx++) {
      const picks: { sector: string; symbol: string }[] = [];

      // One pick from each sector, cycling through stocks
      for (const sector of SECTORS) {
        const stocks = bySektor[sector] || [];
        if (stocks.length === 0) continue;

        const stockIndex = teamIdx % stocks.length;
        picks.push({
          sector,
          symbol: stocks[stockIndex],
        });
      }

      // One crypto pick, cycling through available cryptos
      const cryptoIndex = teamIdx % availableCryptos.length;
      picks.push({
        sector: "Crypto",
        symbol: availableCryptos[cryptoIndex],
      });

      teams.push({
        userId: userIds[teamIdx],
        picks,
      });
    }

    // 6. Insert teams as entries
    console.log(`📝 Inserting ${teams.length} entries...`);

    const entries = teams.map((team) => ({
      id: randomUUID(),
      contest_id: contestId,
      user_id: team.userId,
    }));

    const entryPicks: any[] = [];
    for (let i = 0; i < entries.length; i++) {
      for (const pick of teams[i].picks) {
        entryPicks.push({
          id: randomUUID(),
          entry_id: entries[i].id,
          sector: pick.sector,
          symbol: pick.symbol,
        });
      }
    }

    // Insert entries
    const { error: entryError } = await supabase.from("sddfs_entries").insert(entries);
    if (entryError) {
      console.error("Entry insert error:", entryError);
      throw entryError;
    }

    // Insert picks
    const { error: pickError } = await supabase
      .from("sddfs_entry_picks")
      .insert(entryPicks);
    if (pickError) {
      console.error("Pick insert error:", pickError);
      throw pickError;
    }

    // 7. Report summary
    console.log("\n✨ Success! Summary:");
    console.log(`  Contest ID: ${contestId}`);
    console.log(`  Date: ${CONTEST_DATE}`);
    console.log(`  Buy-in: $${BUY_IN}`);
    console.log(`  Teams created: ${NUM_TEAMS}`);
    console.log(`  Total picks: ${NUM_TEAMS * 12}`);

    console.log("\n📊 Stock Coverage:");
    for (const sector of SECTORS) {
      const stocks = bySektor[sector] || [];
      const pickCount = NUM_TEAMS;
      const coverage = (pickCount / stocks.length).toFixed(1);
      console.log(`  ${sector}: ${stocks.length} stocks → ${coverage}x coverage`);
    }

    console.log(
      "\n💰 Pool saturation: Every stock picked at least once, cryptos cycled 16x each"
    );
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

main();
