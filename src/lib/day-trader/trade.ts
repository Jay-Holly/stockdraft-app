import "server-only";

import { DAY_TRADER_MAX_POSITIONS } from "@/lib/day-trader/constants";
import { loadDayTraderPortfolio } from "@/lib/day-trader/portfolio";
import { assertDayTraderTradingAllowed } from "@/lib/day-trader/trading-gates";
import type { DayTraderPortfolioView } from "@/lib/day-trader/portfolio";
import { isStockPickEligible } from "@/lib/draft/engine";
import { getStockQuote } from "@/lib/roster/quotes";
import { createClient } from "@/lib/supabase/server";

export type DayTraderTradeResult =
  | { ok: true; portfolio: DayTraderPortfolioView }
  | { ok: false; error: string };

type PositionRow = {
  id: string;
  symbol: string;
  shares: number;
  slot_order: number;
};

async function loadEntryPositions(
  entryId: string
): Promise<PositionRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("day_trader_positions")
    .select("id, symbol, shares, slot_order")
    .eq("entry_id", entryId)
    .order("slot_order", { ascending: true });

  if (error) {
    throw new Error(`Failed to load positions: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    symbol: String(row.symbol).toUpperCase(),
    shares: Number(row.shares),
    slot_order: row.slot_order,
  }));
}

async function insertTradeLog(input: {
  entryId: string;
  symbol: string;
  side: "buy" | "sell";
  shares: number;
  price: number;
  notional: number;
}) {
  const supabase = await createClient();
  const { error } = await supabase.from("day_trader_trades").insert({
    entry_id: input.entryId,
    symbol: input.symbol,
    side: input.side,
    shares: input.shares,
    price: input.price,
    notional: input.notional,
  });

  if (error) {
    throw new Error(`Failed to log trade: ${error.message}`);
  }
}

export async function executeDayTraderBuy(
  userId: string,
  symbolInput: string,
  notional: number,
  now: Date = new Date()
): Promise<DayTraderTradeResult> {
  const gate = await assertDayTraderTradingAllowed(userId, now);
  if (!gate.ok) return gate;

  const symbol = symbolInput.trim().toUpperCase();
  if (!symbol) {
    return { ok: false, error: "Enter a stock symbol to buy." };
  }

  if (!Number.isFinite(notional) || notional <= 0) {
    return { ok: false, error: "Enter a dollar amount greater than zero." };
  }

  const quote = await getStockQuote(symbol);
  if (!isStockPickEligible(symbol, quote.price)) {
    return {
      ok: false,
      error: "That symbol is not eligible or has no live price.",
    };
  }

  const cashBalance = Number(gate.entry.cash_balance);
  if (notional > cashBalance + 0.000001) {
    return { ok: false, error: "Not enough cash for this purchase." };
  }

  const spend = Math.min(notional, cashBalance);
  const shares = spend / quote.price;
  if (shares <= 0) {
    return { ok: false, error: "Purchase amount is too small for one share." };
  }

  const positions = await loadEntryPositions(gate.entry.id);
  const existing = positions.find((position) => position.symbol === symbol);
  const uniqueSymbols = positions.length;

  if (!existing && uniqueSymbols >= DAY_TRADER_MAX_POSITIONS) {
    return {
      ok: false,
      error: `You can hold at most ${DAY_TRADER_MAX_POSITIONS} stocks. Sell one before buying a new symbol.`,
    };
  }

  const supabase = await createClient();
  const nextCash = cashBalance - spend;

  const { error: cashError } = await supabase
    .from("day_trader_entries")
    .update({ cash_balance: nextCash })
    .eq("id", gate.entry.id)
    .eq("user_id", userId);

  if (cashError) {
    return { ok: false, error: cashError.message };
  }

  if (existing) {
    const { error: updateError } = await supabase
      .from("day_trader_positions")
      .update({ shares: existing.shares + shares })
      .eq("id", existing.id)
      .eq("entry_id", gate.entry.id);

    if (updateError) {
      await supabase
        .from("day_trader_entries")
        .update({ cash_balance: cashBalance })
        .eq("id", gate.entry.id);
      return { ok: false, error: updateError.message };
    }
  } else {
    const nextSlot =
      positions.reduce(
        (max, position) => Math.max(max, position.slot_order),
        -1
      ) + 1;

    const { error: insertError } = await supabase
      .from("day_trader_positions")
      .insert({
        entry_id: gate.entry.id,
        symbol,
        shares,
        slot_order: nextSlot,
      });

    if (insertError) {
      await supabase
        .from("day_trader_entries")
        .update({ cash_balance: cashBalance })
        .eq("id", gate.entry.id);
      return { ok: false, error: insertError.message };
    }
  }

  await insertTradeLog({
    entryId: gate.entry.id,
    symbol,
    side: "buy",
    shares,
    price: quote.price,
    notional: spend,
  });

  const { data: refreshedEntry } = await supabase
    .from("day_trader_entries")
    .select("*")
    .eq("id", gate.entry.id)
    .single();

  const portfolio = await loadDayTraderPortfolio(refreshedEntry ?? gate.entry);
  return { ok: true, portfolio };
}

export async function executeDayTraderSell(
  userId: string,
  symbolInput: string,
  sharesToSell: number | null,
  now: Date = new Date()
): Promise<DayTraderTradeResult> {
  const gate = await assertDayTraderTradingAllowed(userId, now);
  if (!gate.ok) return gate;

  const symbol = symbolInput.trim().toUpperCase();
  if (!symbol) {
    return { ok: false, error: "Select a position to sell." };
  }

  const positions = await loadEntryPositions(gate.entry.id);
  const existing = positions.find((position) => position.symbol === symbol);
  if (!existing) {
    return { ok: false, error: `You do not hold ${symbol}.` };
  }

  const sellShares =
    sharesToSell == null ? existing.shares : Number(sharesToSell);
  if (!Number.isFinite(sellShares) || sellShares <= 0) {
    return { ok: false, error: "Enter a share amount greater than zero." };
  }

  if (sellShares > existing.shares + 0.000001) {
    return { ok: false, error: "Cannot sell more shares than you hold." };
  }

  const quote = await getStockQuote(symbol);
  if (quote.price <= 0) {
    return { ok: false, error: "No live price available for this symbol." };
  }

  const proceeds = sellShares * quote.price;
  const cashBalance = Number(gate.entry.cash_balance);
  const nextCash = cashBalance + proceeds;
  const remainingShares = existing.shares - sellShares;
  const supabase = await createClient();

  const { error: cashError } = await supabase
    .from("day_trader_entries")
    .update({ cash_balance: nextCash })
    .eq("id", gate.entry.id)
    .eq("user_id", userId);

  if (cashError) {
    return { ok: false, error: cashError.message };
  }

  if (remainingShares <= 0.0000001) {
    const { error: deleteError } = await supabase
      .from("day_trader_positions")
      .delete()
      .eq("id", existing.id)
      .eq("entry_id", gate.entry.id);

    if (deleteError) {
      await supabase
        .from("day_trader_entries")
        .update({ cash_balance: cashBalance })
        .eq("id", gate.entry.id);
      return { ok: false, error: deleteError.message };
    }
  } else {
    const { error: updateError } = await supabase
      .from("day_trader_positions")
      .update({ shares: remainingShares })
      .eq("id", existing.id)
      .eq("entry_id", gate.entry.id);

    if (updateError) {
      await supabase
        .from("day_trader_entries")
        .update({ cash_balance: cashBalance })
        .eq("id", gate.entry.id);
      return { ok: false, error: updateError.message };
    }
  }

  await insertTradeLog({
    entryId: gate.entry.id,
    symbol,
    side: "sell",
    shares: sellShares,
    price: quote.price,
    notional: proceeds,
  });

  const { data: refreshedEntry } = await supabase
    .from("day_trader_entries")
    .select("*")
    .eq("id", gate.entry.id)
    .single();

  const portfolio = await loadDayTraderPortfolio(refreshedEntry ?? gate.entry);
  return { ok: true, portfolio };
}
