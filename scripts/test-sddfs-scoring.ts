#!/usr/bin/env node

/**
 * Test script: lock the Monday SDDFS contest, populate prices, and score it.
 * Uses real market data from the price log for a recent trading day.
 */

import { createServiceClient } from "../src/lib/supabase/service";
import { finalizeSddfsContest } from "../src/lib/sddfs/scoring";

const CONTEST_DATE = "2026-09-01";
const BUY_IN = 2;

async function main() {
  try {
    const supabase = createServiceClient();

    // 1. Get the contest
    console.log("🔍 Finding contest...");
    const { data: contests } = await supabase
      .from("sddfs_contests")
      .select("id, status")
      .eq("contest_date", CONTEST_DATE)
      .eq("buy_in", BUY_IN)
      .maybeSingle();

    if (!contests) {
      throw new Error(`No contest found for ${CONTEST_DATE}`);
    }

    const contestId = contests.id;
    console.log(`✅ Contest: ${contestId} (status: ${contests.status})`);

    // 2. Lock the contest
    console.log("🔒 Locking contest...");
    const { error: lockError } = await supabase
      .from("sddfs_contests")
      .update({ status: "locked" })
      .eq("id", contestId);

    if (lockError) throw lockError;
    console.log("✅ Contest locked");

    // 3. Get all picks in the contest
    console.log("📋 Loading picks...");
    const { data: entries } = await supabase
      .from("sddfs_entries")
      .select("id")
      .eq("contest_id", contestId);

    if (!entries || entries.length === 0) {
      throw new Error("No entries found");
    }

    const { data: picks } = await supabase
      .from("sddfs_entry_picks")
      .select("id, symbol")
      .in(
        "entry_id",
        entries.map((e) => e.id)
      );

    if (!picks || picks.length === 0) {
      throw new Error("No picks found");
    }

    console.log(`✅ Loaded ${entries.length} entries with ${picks.length} picks`);

    // 4. Get real price data from price_log for today
    // Use a recent trading day to get real market data
    console.log("💰 Fetching real market data from price log...");
    const testDate = "2026-08-29"; // Last trading day before this Saturday

    const { data: priceLogData } = await supabase
      .from("price_log")
      .select("symbol, open_price, close_price")
      .eq("date", testDate)
      .in(
        "symbol",
        picks.map((p) => p.symbol)
      );

    if (!priceLogData || priceLogData.length === 0) {
      console.warn("⚠️  No price log data found for", testDate);
      console.log("📝 Will use synthetic prices for testing...");
    }

    // Create a price map with real or synthetic data
    const priceMap = new Map<string, { open: number; close: number }>();
    if (priceLogData) {
      for (const row of priceLogData) {
        if (row.open_price && row.close_price) {
          priceMap.set(row.symbol, {
            open: row.open_price,
            close: row.close_price,
          });
        }
      }
    }

    // For symbols without price data, generate plausible synthetic prices
    // This ensures all entries can be scored
    const synthetic = (symbol: string): { open: number; close: number } => {
      // Deterministic based on symbol for reproducibility
      const seed = symbol.charCodeAt(0) + symbol.charCodeAt(1);
      const basePrice = 50 + (seed % 250);
      const changePercent = ((seed % 20) - 10) / 100; // -10% to +10%
      const open = basePrice;
      const close = basePrice * (1 + changePercent);
      return { open, close };
    };

    // 5. Populate open and close prices for all picks
    console.log("📝 Populating pick prices...");
    let pricesApplied = 0;
    for (const pick of picks) {
      const prices =
        priceMap.get(pick.symbol) || synthetic(pick.symbol);
      const pctChange = ((prices.close - prices.open) / prices.open) * 100;

      const { error: updateError } = await supabase
        .from("sddfs_entry_picks")
        .update({
          open_price: prices.open,
          close_price: prices.close,
          pct_change: pctChange,
        })
        .eq("id", pick.id);

      if (updateError) {
        console.error(`Failed to update pick ${pick.id}:`, updateError);
      } else {
        pricesApplied++;
      }
    }

    console.log(`✅ Updated ${pricesApplied}/${picks.length} picks with prices`);

    // 6. Score the contest
    console.log("🏆 Scoring contest...");
    const result = await finalizeSddfsContest(supabase, contestId, {
      creditWallets: false, // Don't actually credit wallets in test
    });

    console.log(`✅ Scored! ${result.entriesScored} entries ranked and paid out`);

    // 7. Show results
    console.log("\n📊 Contest Results:");
    const { data: results } = await supabase
      .from("sddfs_entries")
      .select("id, total_score, final_rank, payout")
      .eq("contest_id", contestId)
      .order("final_rank")
      .limit(10);

    if (results) {
      console.log("\nTop 10:");
      for (const entry of results) {
        const payout =
          entry.payout !== null
            ? `$${Number(entry.payout).toFixed(2)}`
            : "—";
        console.log(
          `  #${entry.final_rank}: ${entry.total_score?.toFixed(2)}% → ${payout}`
        );
      }
    }

    console.log("\n✨ Test complete!");
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

main();
