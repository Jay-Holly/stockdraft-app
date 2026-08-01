/**
 * Crypto repair for SDPL8-00097. Read-only unless run with --apply.
 * Run this BEFORE scripts/repair-sdpl8-00097.mjs — that script rebuilds round
 * numbers and week-1 opening values from whatever picks exist at the time.
 *
 * Two changes, both authorised in session:
 *   1. Top up the two teams that finished the draft with crypto budget left
 *      (Jay's Crew $50,000, Practice team $47,000) by buying the cheapest
 *      coin available to them.
 *   2. Redo the three bot teams' crypto buys. All three dumped $200,000 into
 *      Bitcoin at the 20/40/80% surcharge tiers; Cedar Point turned $200,000
 *      into a $40,000 position. They now buy the lowest-surcharge coin, which
 *      is what the fixed ai-strategy would have done.
 *
 * Human picks other than the two top-ups are left exactly as drafted.
 *
 * Usage: npx tsx --tsconfig tsconfig.json scripts/repair-sdpl8-00097-crypto.ts [--apply]
 */

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

function loadEnv(p: string) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i === -1) continue;
    const k = line.slice(0, i);
    const v = line.slice(i + 1).replace(/^["']|["']$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv(path.join(process.cwd(), ".env.local"));
loadEnv(path.join(process.cwd(), "env.local"));

import { computeCryptoPick, getSurchargePercent } from "@/lib/draft/engine";
import { CRYPTO_POOL } from "@/lib/draft/types";

const APPLY = process.argv.includes("--apply");
const SUPPORT_CODE = "SDPL8-00097";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const say = (s = "") => console.log(s);
const banner = (s: string) =>
  say(`\n${"=".repeat(76)}\n${s}\n${"=".repeat(76)}`);

/**
 * Same endpoint src/lib/coingecko/service.ts uses. Never throws — a failure
 * just leaves the symbol absent and the caller falls back to the pool's
 * reference price.
 */
async function fetchLivePrices(
  coins: { symbol: string; id: string | null }[]
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const withIds = coins.filter((c) => c.id);
  for (let i = 0; i < withIds.length; i += 100) {
    const chunk = withIds.slice(i, i + 100);
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${chunk
      .map((c) => c.id)
      .join(",")}&vs_currencies=usd`;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const json = (await res.json()) as Record<string, { usd?: number }>;
      for (const c of chunk) {
        const price = json[c.id!]?.usd;
        if (typeof price === "number" && price > 0) {
          out[c.symbol.toUpperCase()] = price;
        }
      }
    } catch {
      // fall through to reference prices
    }
    if (i + 100 < withIds.length) await new Promise((r) => setTimeout(r, 1200));
  }
  return out;
}

async function main() {
const { data: leagues } = await sb
  .from("leagues")
  .select("*")
  .eq("support_code", SUPPORT_CODE);
const L = leagues![0];

say(`League ${L.support_code} "${L.name}"  week=${L.current_week}`);
say(APPLY ? "\n*** APPLY MODE — writes are live ***" : "\n(dry run — no writes)");

const { data: matchups } = await sb
  .from("league_matchups")
  .select("status, home_score")
  .eq("league_id", L.id);
if ((matchups ?? []).some((m) => m.status === "complete" || m.home_score != null)) {
  console.error("\nABORT: league has scored games; refusing to rewrite picks.");
  process.exit(1);
}

const { data: members } = await sb
  .from("league_members")
  .select("user_id, display_name, bot_personality, draft_slot")
  .eq("league_id", L.id)
  .order("draft_slot", { ascending: true, nullsFirst: false });

const { data: drafts } = await sb
  .from("drafts")
  .select("id, user_id")
  .eq("league_id", L.id);
const draftIdFor = new Map(drafts!.map((d) => [d.user_id, d.id]));

const { data: picks } = await sb
  .from("draft_picks")
  .select("*")
  .in("draft_id", drafts!.map((d) => d.id));

// fetchCryptoPool() builds a request-scoped Supabase client, so read the pool
// directly with the service client. Same rows, same market-cap-rank order.
// fetchCryptoPool()/getCryptoQuotesMap() build a request-scoped Supabase
// client, so read the pool with the service client and go straight to the
// CoinGecko service for prices. Same rows, same market-cap-rank order.
const { data: pool } = await sb
  .from("crypto_pool")
  .select("symbol, market_cap_rank, reference_price_usd, coingecko_id")
  .order("market_cap_rank", { ascending: true });
const poolSymbols = (pool ?? []).map((c) => c.symbol.toUpperCase());

const live = await fetchLivePrices(
  (pool ?? []).map((c) => ({ symbol: c.symbol, id: c.coingecko_id }))
);
const quotes: Record<string, { price: number }> = {};
let liveCount = 0;
for (const row of pool ?? []) {
  const s = row.symbol.toUpperCase();
  const livePrice = live[s] ?? 0;
  if (livePrice > 0) liveCount++;
  quotes[s] = { price: livePrice > 0 ? livePrice : Number(row.reference_price_usd ?? 0) };
}
say(`\nprices: ${liveCount} live from CoinGecko, ${poolSymbols.length - liveCount} from pool reference`);

say(`crypto pool: ${poolSymbols.length} coins`);

// Buyer counts as they stand from the picks we are keeping (all human picks
// except the two top-ups, which are additions rather than rewrites).
const botUserIds = new Set(
  members!.filter((m) => m.bot_personality).map((m) => m.user_id)
);
const keptCrypto = picks!.filter(
  (p) => p.pick_type === "crypto" && !botUserIds.has(p.user_id)
);
const buyerCounts = new Map<string, number>();
for (const p of keptCrypto) {
  const s = p.symbol.toUpperCase();
  buyerCounts.set(s, (buyerCounts.get(s) ?? 0) + 1);
}

say("\nbuyer counts after removing the three bot buys:");
for (const [s, n] of [...buyerCounts].sort())
  say(`  ${s}: ${n} → next buyer pays ${getSurchargePercent(n)}%`);

/** Cheapest coin this manager doesn't already hold, with a usable quote. */
function cheapestCoinFor(userId: string): string | null {
  const held = new Set(
    picks!
      .filter((p) => p.user_id === userId && p.pick_type === "crypto")
      .map((p) => p.symbol.toUpperCase())
  );
  const ranked = poolSymbols
    .filter((s) => !held.has(s))
    .filter((s) => (quotes[s]?.price ?? 0) > 0)
    .sort((a, b) => {
      const bySurcharge =
        getSurchargePercent(buyerCounts.get(a) ?? 0) -
        getSurchargePercent(buyerCounts.get(b) ?? 0);
      return bySurcharge !== 0
        ? bySurcharge
        : poolSymbols.indexOf(a) - poolSymbols.indexOf(b);
    });
  return ranked[0] ?? null;
}

type Change = {
  kind: "topup" | "rebuy";
  team: string;
  userId: string;
  pickId?: string;
  fromSymbol?: string;
  fromEffective?: number;
  symbol: string;
  allocation: number;
  price: number;
  surchargePercent: number;
  effectiveValue: number;
  shares: number;
  pickOrder: number;
};
const changes: Change[] = [];

// ------------------------------------------------------------ 1. top-ups
banner("1. TOP UP UNSPENT CRYPTO BUDGET");

for (const m of members!) {
  if (m.bot_personality) continue;
  const mine = picks!.filter((p) => p.user_id === m.user_id);
  const spent = mine
    .filter((p) => p.pick_type === "crypto")
    .reduce((s, p) => s + Number(p.budget_spent), 0);
  const remaining = CRYPTO_POOL - spent;
  if (remaining <= 0) continue;

  const symbol = cheapestCoinFor(m.user_id);
  if (!symbol) {
    say(`  ${m.display_name}: no coin available — skipped`);
    continue;
  }
  const price = quotes[symbol]!.price;
  const count = buyerCounts.get(symbol) ?? 0;
  const c = computeCryptoPick(remaining, price, count);
  buyerCounts.set(symbol, count + 1);

  changes.push({
    kind: "topup",
    team: m.display_name,
    userId: m.user_id,
    symbol,
    allocation: remaining,
    price,
    surchargePercent: c.surchargePercent,
    effectiveValue: c.effectiveValue,
    shares: c.shares,
    pickOrder: Math.max(...mine.map((p) => p.pick_order)) + 1,
  });

  say(
    `  ${m.display_name.padEnd(16)} +$${remaining.toLocaleString()} → ${symbol} @ $${price.toLocaleString()} ` +
      `(${c.surchargePercent}% surcharge, ${c.shares.toFixed(4)} units, $${Math.round(c.effectiveValue).toLocaleString()} of value)`
  );
}
if (changes.length === 0) say("  nothing to top up");

// -------------------------------------------------------------- 2. bots
banner("2. REDO BOT CRYPTO BUYS");

for (const m of members!) {
  if (!m.bot_personality) continue;
  const mine = picks!.filter((p) => p.user_id === m.user_id);
  for (const old of mine.filter((p) => p.pick_type === "crypto")) {
    const symbol = cheapestCoinFor(m.user_id);
    if (!symbol) {
      say(`  ${m.display_name}: no coin available — left as drafted`);
      continue;
    }
    const price = quotes[symbol]!.price;
    const count = buyerCounts.get(symbol) ?? 0;
    const allocation = Number(old.budget_spent);
    const c = computeCryptoPick(allocation, price, count);
    buyerCounts.set(symbol, count + 1);

    changes.push({
      kind: "rebuy",
      team: m.display_name,
      userId: m.user_id,
      pickId: old.id,
      fromSymbol: old.symbol,
      fromEffective: Number(old.effective_value),
      symbol,
      allocation,
      price,
      surchargePercent: c.surchargePercent,
      effectiveValue: c.effectiveValue,
      shares: c.shares,
      pickOrder: old.pick_order,
    });

    say(
      `  ${m.display_name.padEnd(20)} ${old.symbol} @${old.surcharge_percent}% ($${Math.round(Number(old.effective_value)).toLocaleString()} of value)` +
        `  →  ${symbol} @${c.surchargePercent}% ($${Math.round(c.effectiveValue).toLocaleString()} of value)` +
        `   recovers $${Math.round(c.effectiveValue - Number(old.effective_value)).toLocaleString()}`
    );
  }
}

// ------------------------------------------------------------- 3. apply
banner(APPLY ? "APPLYING" : "DRY RUN — re-run with --apply to write");

if (APPLY) {
  for (const ch of changes) {
    if (ch.kind === "rebuy") {
      const { error } = await sb
        .from("draft_picks")
        .update({
          symbol: ch.symbol,
          price_at_pick: ch.price,
          budget_spent: ch.allocation,
          shares: ch.shares,
          surcharge_percent: ch.surchargePercent,
          effective_value: ch.effectiveValue,
        })
        .eq("id", ch.pickId!);
      if (error) throw new Error(`rebuy ${ch.pickId}: ${error.message}`);
    } else {
      const { error } = await sb.from("draft_picks").insert({
        draft_id: draftIdFor.get(ch.userId),
        user_id: ch.userId,
        // Placed in the open phase; repair-sdpl8-00097.mjs renumbers rounds.
        round_number: 13,
        pick_type: "crypto",
        symbol: ch.symbol,
        price_at_pick: ch.price,
        budget_spent: ch.allocation,
        shares: ch.shares,
        surcharge_percent: ch.surchargePercent,
        effective_value: ch.effectiveValue,
        pick_order: ch.pickOrder,
      });
      if (error) throw new Error(`topup ${ch.team}: ${error.message}`);
    }
  }

  for (const [symbol, count] of buyerCounts) {
    const { error } = await sb
      .from("league_crypto_buyer_counts")
      .upsert(
        { league_id: L.id, symbol, buyer_count: count },
        { onConflict: "league_id,symbol" }
      );
    if (error) throw new Error(`buyer count ${symbol}: ${error.message}`);
  }

  // Stale rows for coins nobody holds any more (the abandoned BTC buys).
  const held = new Set(buyerCounts.keys());
  const { data: existingCounts } = await sb
    .from("league_crypto_buyer_counts")
    .select("symbol")
    .eq("league_id", L.id);
  for (const row of existingCounts ?? []) {
    if (!held.has(row.symbol)) {
      await sb
        .from("league_crypto_buyer_counts")
        .delete()
        .eq("league_id", L.id)
        .eq("symbol", row.symbol);
    }
  }

  say(`  applied ${changes.length} changes and rewrote buyer counts`);
  say(`  NEXT: node scripts/repair-sdpl8-00097.mjs --apply`);
} else {
  const recovered = changes
    .filter((c) => c.kind === "rebuy")
    .reduce((s, c) => s + (c.effectiveValue - (c.fromEffective ?? 0)), 0);
  const added = changes
    .filter((c) => c.kind === "topup")
    .reduce((s, c) => s + c.effectiveValue, 0);
  say(`  ${changes.length} changes staged`);
  say(`  value recovered for bots: $${Math.round(recovered).toLocaleString()}`);
  say(`  value added for the two short teams: $${Math.round(added).toLocaleString()}`);
}
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
