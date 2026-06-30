/**
 * Pull raw crypto position data for SDAI-00039 investigation.
 * Run: node scripts/investigate-sdai-crypto.mjs
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env (.env.local loaded).
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
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supportCode = process.argv[2] ?? "SDAI-00039";

if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CRYPTO = new Set(["BTC", "ETH", "XRP"]);

function fmt(n) {
  if (n == null || Number.isNaN(n)) return "null";
  return Number(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

async function main() {
  const { data: league, error: leagueErr } = await supabase
    .from("leagues")
    .select("id, support_code, name, current_week, status")
    .eq("support_code", supportCode)
    .maybeSingle();

  if (leagueErr || !league) {
    console.error("League not found:", supportCode, leagueErr?.message);
    process.exit(1);
  }

  console.log("=== LEAGUE ===");
  console.log(JSON.stringify(league, null, 2));

  const { data: members } = await supabase
    .from("league_members")
    .select("user_id, display_name, draft_slot")
    .eq("league_id", league.id)
    .order("draft_slot", { ascending: true });

  const human =
    members?.find((m) => !String(m.user_id).includes("bot")) ?? members?.[0];

  if (!human) {
    console.error("No league members found");
    process.exit(1);
  }

  const userId = human.user_id;
  console.log("\n=== HUMAN MEMBER ===");
  console.log({ userId, displayName: human.display_name });

  const { data: draft } = await supabase
    .from("drafts")
    .select("id, status")
    .eq("league_id", league.id)
    .eq("user_id", userId)
    .maybeSingle();

  const { data: picks } = await supabase
    .from("draft_picks")
    .select(
      "id, symbol, pick_type, budget_spent, shares, effective_value, price_at_pick, updated_at, acquired_via"
    )
    .eq("draft_id", draft?.id ?? "")
    .eq("pick_type", "crypto")
    .order("symbol");

  console.log("\n=== DRAFT_PICKS (crypto) ===");
  for (const pick of picks ?? []) {
    const sym = pick.symbol.toUpperCase();
    if (!CRYPTO.has(sym) && pick.budget_spent <= 0.01) continue;
    const impliedValue = Number(pick.shares) * Number(pick.price_at_pick);
    console.log({
      id: pick.id,
      symbol: sym,
      budget_spent: fmt(pick.budget_spent),
      shares: Number(pick.shares),
      effective_value: fmt(pick.effective_value),
      price_at_pick: fmt(pick.price_at_pick),
      shares_x_price_at_pick: fmt(impliedValue),
      updated_at: pick.updated_at,
      acquired_via: pick.acquired_via,
    });
  }

  const pickIds = (picks ?? []).map((p) => p.id);

  const { data: baselines } = await supabase
    .from("roster_week_baselines")
    .select(
      "pick_id, week_number, value_at_open, value_at_close, stock_value_at_friday_close, captured_at"
    )
    .eq("league_id", league.id)
    .eq("user_id", userId)
    .in("pick_id", pickIds.length ? pickIds : ["00000000-0000-0000-0000-000000000000"])
    .order("week_number")
    .order("pick_id");

  console.log("\n=== ROSTER_WEEK_BASELINES (crypto picks) ===");
  const pickById = new Map((picks ?? []).map((p) => [p.id, p.symbol.toUpperCase()]));
  for (const row of baselines ?? []) {
    const sym = pickById.get(row.pick_id) ?? row.pick_id;
    if (!CRYPTO.has(sym)) continue;
    console.log({
      symbol: sym,
      week: row.week_number,
      value_at_open: fmt(row.value_at_open),
      value_at_close: row.value_at_close != null ? fmt(row.value_at_close) : null,
      stock_value_at_friday_close:
        row.stock_value_at_friday_close != null
          ? fmt(row.stock_value_at_friday_close)
          : null,
      captured_at: row.captured_at,
    });
  }

  const { data: moves } = await supabase
    .from("roster_moves")
    .select("*")
    .eq("league_id", league.id)
    .eq("user_id", userId)
    .in("move_type", ["crypto_rebalance", "crypto_swap"])
    .order("created_at", { ascending: true });

  console.log("\n=== ROSTER_MOVES (crypto rebalance/swap) ===");
  for (const move of moves ?? []) {
    console.log({
      created_at: move.created_at,
      move_type: move.move_type,
      prior_symbol: move.prior_symbol,
      symbol: move.symbol,
      budget_before: fmt(move.budget_before),
      budget_after: fmt(move.budget_after),
      price_at_move: fmt(move.price_at_move),
      shares_after: move.shares_after,
      notes: move.notes,
      pick_id: move.pick_id,
      related_pick_id: move.related_pick_id,
    });
  }

  // Live crypto quotes from DB pool if available
  const symbols = [...CRYPTO];
  const { data: poolRows } = await supabase
    .from("crypto_prices")
    .select("symbol, price, change_percent, updated_at")
    .in("symbol", symbols);

  console.log("\n=== CRYPTO_PRICES (live scoring table) ===");
  for (const sym of symbols) {
    const row = poolRows?.find((r) => r.symbol === sym);
    console.log(
      sym,
      row
        ? {
            price: fmt(row.price),
            change_percent: row.change_percent,
            updated_at: row.updated_at,
          }
        : "(no row — scoring falls back to crypto_pool.reference_price_usd)"
    );
  }

  const { data: refRows } = await supabase
    .from("crypto_pool")
    .select("symbol, reference_price_usd, updated_at")
    .in("symbol", symbols);

  console.log("\n=== CRYPTO_POOL reference (fallback only) ===");
  for (const sym of symbols) {
    const row = poolRows?.find((r) => r.symbol === sym);
    console.log(
      sym,
      row
        ? {
            reference_price_usd: fmt(row.reference_price_usd),
            updated_at: row.updated_at,
          }
        : "(no row)"
    );
  }

  // Compute what the app would show for each crypto pick at current week
  console.log("\n=== DERIVED METRICS (mirrors app logic) ===");
  const currentWeek = league.current_week ?? 1;
  for (const pick of picks ?? []) {
    const sym = pick.symbol.toUpperCase();
    if (!CRYPTO.has(sym) && Number(pick.budget_spent) <= 0.01) continue;

    const pool = poolRows?.find((r) => r.symbol === sym);
    const livePrice = pool ? Number(pool.price) : Number(pick.price_at_pick);
    const currentValue = Number(pick.shares) * livePrice;

    const weekRows = (baselines ?? []).filter(
      (b) => b.pick_id === pick.id && b.week_number === currentWeek
    );
    const week1Rows = (baselines ?? []).filter(
      (b) => b.pick_id === pick.id && b.week_number === 1
    );
    const weekOpen =
      weekRows[0]?.value_at_open != null
        ? Number(weekRows[0].value_at_open)
        : currentValue;
    const week1Open =
      week1Rows[0]?.value_at_open != null
        ? Number(week1Rows[0].value_at_open)
        : weekOpen;

    const weeklyDollar = currentValue - weekOpen;
    const weeklyPct = weekOpen > 0 ? (weeklyDollar / weekOpen) * 100 : 0;

    let seasonDollar = weeklyDollar;
    if (currentWeek > 1) {
      seasonDollar = 0;
      for (let w = 1; w < currentWeek; w++) {
        const row = (baselines ?? []).find(
          (b) => b.pick_id === pick.id && b.week_number === w
        );
        if (row?.value_at_close != null) {
          seasonDollar +=
            Number(row.value_at_close) - Number(row.value_at_open);
        }
      }
      seasonDollar += weeklyDollar;
    }

    const seasonEndValue = week1Open + seasonDollar;
    const seasonPct =
      week1Open > 0 ? ((seasonEndValue - week1Open) / week1Open) * 100 : 0;

    console.log({
      symbol: sym,
      currentWeek,
      livePrice: fmt(livePrice),
      budget_spent: fmt(pick.budget_spent),
      shares: Number(pick.shares),
      currentValue_shares_x_price: fmt(currentValue),
      weekOpen_baseline: fmt(weekOpen),
      week1Open_baseline: fmt(week1Open),
      weekly_dollar: fmt(weeklyDollar),
      weekly_pct: weeklyPct.toFixed(4) + "%",
      season_dollar: fmt(seasonDollar),
      season_pct: seasonPct.toFixed(4) + "%",
      mismatch_budget_vs_value:
        Math.abs(Number(pick.budget_spent) - currentValue) > 1
          ? `budget ${fmt(pick.budget_spent)} vs mkt ${fmt(currentValue)}`
          : "none",
      mismatch_week1open_vs_weekopen:
        Math.abs(week1Open - weekOpen) > 0.01
          ? `week1 ${fmt(week1Open)} vs week${currentWeek} ${fmt(weekOpen)}`
          : "none",
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
