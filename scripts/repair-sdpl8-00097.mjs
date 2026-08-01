#!/usr/bin/env node
/**
 * Targeted repair for league SDPL8-00097, read-only unless run with --apply.
 *
 * Repairs only what is unambiguously corrupt and safe to rewrite while the
 * league sits at week 1 with nothing scored:
 *   1. Regenerate the regular-season schedule with the fixed round-robin.
 *   2. Delete look-ahead week-10 baselines (raw share prices, written by the
 *      pre-fix captureOpeningValueForPick).
 *   3. Reset bot week-1 opening baselines to what the bot actually paid, so
 *      no team starts the season already up or down.
 *   4. Renumber draft picks onto the canonical 1-13 open / 14-15 bench layout.
 *
 * Deliberately NOT repaired (needs a human decision — see the session notes):
 *   - Jay's Crew ($150k) and Practice team ($153k) unspent crypto budget.
 *   - The bots' 20/40/80% surcharge Bitcoin buys.
 *
 * Usage: node scripts/repair-sdpl8-00097.mjs [--apply]
 */

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const SUPPORT_CODE = "SDPL8-00097";
const OPEN_ROUNDS = 13;
const BENCH_START_ROUND = 14;
const REGULAR_SEASON_WEEKS = 11;

function loadEnv(p) {
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

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/** Circle-method round robin — mirrors src/lib/matchup/schedule.ts. */
function generateRoundRobinPairings(teamIds) {
  if (teamIds.length < 2) return [];
  const BYE = "__bye__";
  const teams = teamIds.length % 2 === 0 ? [...teamIds] : [...teamIds, BYE];
  const fixed = teams[0];
  const rotating = teams.slice(1);
  const m = rotating.length;
  const schedule = [];
  for (let round = 0; round < m; round++) {
    const ring = rotating.map((_, i) => rotating[(i + round) % m]);
    const pairs = [];
    if (fixed !== BYE && ring[0] !== BYE) pairs.push([fixed, ring[0]]);
    for (let i = 1; i <= (m - 1) / 2; i++) {
      if (ring[i] !== BYE && ring[m - i] !== BYE) pairs.push([ring[i], ring[m - i]]);
    }
    schedule.push(pairs);
  }
  return schedule;
}

const say = (s = "") => console.log(s);
const banner = (s) => say(`\n${"=".repeat(74)}\n${s}\n${"=".repeat(74)}`);

const { data: leagues } = await sb
  .from("leagues")
  .select("*")
  .eq("support_code", SUPPORT_CODE);
if (!leagues?.length) {
  console.error(`No league ${SUPPORT_CODE}`);
  process.exit(1);
}
const L = leagues[0];

say(`League ${L.support_code} "${L.name}"  id=${L.id}`);
say(`status=${L.status} current_week=${L.current_week} players=${L.player_count}`);
say(APPLY ? "\n*** APPLY MODE — writes are live ***" : "\n(dry run — no writes)");

const { data: members } = await sb
  .from("league_members")
  .select("user_id, display_name, bot_personality, draft_slot")
  .eq("league_id", L.id)
  .order("draft_slot", { ascending: true, nullsFirst: false });
const nameOf = (id) =>
  members.find((m) => m.user_id === id)?.display_name ?? String(id).slice(0, 8);

const { data: matchups } = await sb
  .from("league_matchups")
  .select("id, week_number, status, home_score, is_playoff")
  .eq("league_id", L.id);

const { data: drafts } = await sb
  .from("drafts")
  .select("id, user_id")
  .eq("league_id", L.id);
const { data: picks } = await sb
  .from("draft_picks")
  .select("*")
  .in("draft_id", drafts.map((d) => d.id));
const { data: baselines } = await sb
  .from("roster_week_baselines")
  .select("*")
  .eq("league_id", L.id);

const scored = (matchups ?? []).filter(
  (m) => m.status === "complete" || m.home_score != null
);
if (scored.length > 0) {
  console.error(
    `\nABORT: ${scored.length} matchups are already scored. This repair only ` +
      `runs on an unscored league — rewriting a played schedule would ` +
      `invalidate results.`
  );
  process.exit(1);
}

// ---------------------------------------------------------------- 1. schedule
banner("1. SCHEDULE — regenerate with the fixed round robin");

const teamIds = members.map((m) => m.user_id);
const pairings = generateRoundRobinPairings(teamIds);
const newGames = [];
for (let week = 1; week <= REGULAR_SEASON_WEEKS; week++) {
  for (const [home, away] of pairings[(week - 1) % pairings.length]) {
    newGames.push({ weekNumber: week, homeUserId: home, awayUserId: away });
  }
}

const freq = (games, get) => {
  const c = new Map();
  for (const g of games) {
    const k = [nameOf(get(g).h), nameOf(get(g).a)].sort().join(" vs ");
    c.set(k, (c.get(k) ?? 0) + 1);
  }
  return c;
};
const oldMatchupRows = await sb
  .from("league_matchups")
  .select("week_number, home_user_id, away_user_id")
  .eq("league_id", L.id)
  .then((r) => r.data ?? []);
const oldFreq = freq(oldMatchupRows, (g) => ({ h: g.home_user_id, a: g.away_user_id }));
const newFreq = freq(newGames, (g) => ({ h: g.homeUserId, a: g.awayUserId }));
const totalPairs = (members.length * (members.length - 1)) / 2;

say(`  before: ${oldMatchupRows.length} games, max repeat ${Math.max(...oldFreq.values())}x, ${totalPairs - oldFreq.size} pairs never meet`);
say(`  after : ${newGames.length} games, max repeat ${Math.max(...newFreq.values())}x, ${totalPairs - newFreq.size} pairs never meet`);
for (let week = 1; week <= REGULAR_SEASON_WEEKS; week++) {
  const slate = newGames.filter((g) => g.weekNumber === week);
  say(
    `   wk${String(week).padStart(2)} ` +
      slate.map((g) => `${nameOf(g.homeUserId)} v ${nameOf(g.awayUserId)}`).join(" | ")
  );
}

if (APPLY) {
  const { error: delErr } = await sb
    .from("league_matchups")
    .delete()
    .eq("league_id", L.id)
    .eq("is_playoff", false);
  if (delErr) throw new Error(`delete matchups: ${delErr.message}`);

  const rows = newGames.map((g) => ({
    league_id: L.id,
    week_number: g.weekNumber,
    home_user_id: g.homeUserId,
    away_user_id: g.awayUserId,
    is_playoff: false,
    playoff_round: null,
    opponent_bot_id: g.awayUserId,
    opponent_name: `${nameOf(g.homeUserId)} vs ${nameOf(g.awayUserId)}`,
    status: "scheduled",
  }));
  const { error: insErr } = await sb.from("league_matchups").insert(rows);
  if (insErr) throw new Error(`insert matchups: ${insErr.message}`);
  say(`  -> replaced ${oldMatchupRows.length} rows with ${rows.length}`);
}

// -------------------------------------------------- 2. look-ahead baselines
banner("2. LOOK-AHEAD BASELINES — delete weeks beyond the current week");

const future = baselines.filter((b) => b.week_number > (L.current_week ?? 1));
const futureByTeam = new Map();
for (const b of future) {
  const k = `${nameOf(b.user_id)} wk${b.week_number}`;
  futureByTeam.set(k, (futureByTeam.get(k) ?? 0) + 1);
}
if (future.length === 0) say("  none found");
for (const [k, n] of futureByTeam) say(`  ${k}: ${n} rows (stored per-share prices, not position values)`);

if (APPLY && future.length > 0) {
  const { error } = await sb
    .from("roster_week_baselines")
    .delete()
    .eq("league_id", L.id)
    .gt("week_number", L.current_week ?? 1);
  if (error) throw new Error(`delete future baselines: ${error.message}`);
  say(`  -> deleted ${future.length} rows`);
}

// ------------------------------------------------- 3. bot week-1 baselines
banner("3. WEEK-1 OPENING VALUES — reset to what each team actually paid");

const pickById = new Map(picks.map((p) => [p.id, p]));
const week1 = baselines.filter((b) => b.week_number === 1);
const fixes = [];
for (const b of week1) {
  const p = pickById.get(b.pick_id);
  if (!p) continue;
  const paid = Number(p.effective_value);
  const open = Number(b.value_at_open);
  if (Math.abs(paid - open) > 0.5) {
    fixes.push({ id: b.id, user: nameOf(b.user_id), symbol: p.symbol, open, paid });
  }
}
const byTeam = new Map();
for (const f of fixes) {
  const t = byTeam.get(f.user) ?? { n: 0, drift: 0 };
  t.n++;
  t.drift += f.paid - f.open;
  byTeam.set(f.user, t);
}
if (fixes.length === 0) say("  every week-1 open already equals what was paid");
for (const [team, t] of byTeam) {
  say(`  ${team.padEnd(22)} ${String(t.n).padStart(2)} picks, start-of-season swing removed: ${t.drift >= 0 ? "+" : ""}$${Math.round(t.drift).toLocaleString()}`);
}

// Picks added by the crypto repair have no week-1 row at all yet.
const week1PickIds = new Set(week1.map((b) => b.pick_id));
const missingBaselines = picks.filter(
  (p) => p.pick_type !== "skip" && !week1PickIds.has(p.id)
);
for (const p of missingBaselines) {
  say(
    `  ${nameOf(p.user_id).padEnd(22)} ${p.symbol} has no week-1 row — will open at $${Math.round(Number(p.effective_value)).toLocaleString()}`
  );
}

if (APPLY) {
  for (const f of fixes) {
    const { error } = await sb
      .from("roster_week_baselines")
      .update({ value_at_open: f.paid })
      .eq("id", f.id);
    if (error) throw new Error(`baseline ${f.id}: ${error.message}`);
  }
  if (fixes.length) say(`  -> rewrote ${fixes.length} opening values`);

  if (missingBaselines.length) {
    // Upsert, not insert: the roster page's lazy capture may have created a
    // row for a freshly added pick between this script's read and this write,
    // and its value would be a live re-quote rather than what was paid.
    const { error } = await sb.from("roster_week_baselines").upsert(
      missingBaselines.map((p) => ({
        league_id: L.id,
        user_id: p.user_id,
        week_number: 1,
        pick_id: p.id,
        value_at_open: Number(p.effective_value),
      })),
      { onConflict: "league_id,user_id,week_number,pick_id" }
    );
    if (error) throw new Error(`upsert baselines: ${error.message}`);
    say(`  -> wrote ${missingBaselines.length} week-1 rows for new picks`);
  }
}

// ------------------------------------------------------- 4. round numbers
banner("4. DRAFT ROUND NUMBERS — renumber to 1-13 open / 14-15 bench");

const CRYPTO_POOL = 200_000;
const renumbers = [];
const newSkips = [];
const needsDecision = [];

for (const m of members) {
  const mine = picks
    .filter((p) => p.user_id === m.user_id)
    .sort((a, b) => a.pick_order - b.pick_order);

  const openPhase = mine.filter(
    (p) => p.pick_type === "stock" || p.pick_type === "crypto"
  );
  const skips = mine.filter((p) => p.pick_type === "skip");
  const bench = mine.filter((p) => p.pick_type === "bench");
  const cryptoSpent = mine
    .filter((p) => p.pick_type === "crypto")
    .reduce((s, p) => s + Number(p.budget_spent), 0);
  const draftId = mine[0]?.draft_id;
  const maxPickOrder = Math.max(...mine.map((p) => p.pick_order));

  const planned = [];
  let round = 1;
  for (const p of openPhase) planned.push([p, round++]);
  for (const p of skips) planned.push([p, round++]);

  // Spending the crypto pool early forfeits the leftover open rounds — those
  // are recorded as skip rows. Teams that spent the full $200k but have no
  // skip rows never got them because the pre-fix engine stranded their crypto
  // buy outside the open phase, where pushback never fired.
  let added = 0;
  if (cryptoSpent >= CRYPTO_POOL) {
    while (round <= OPEN_ROUNDS) {
      newSkips.push({
        draft_id: draftId,
        user_id: m.user_id,
        round_number: round,
        pick_type: "skip",
        symbol: "SKIP",
        price_at_pick: 0,
        budget_spent: 0,
        shares: 0,
        surcharge_percent: 0,
        effective_value: 0,
        pick_order: maxPickOrder + 1 + added,
      });
      round++;
      added++;
    }
  }

  let benchSeen = 0;
  for (const p of bench) planned.push([p, BENCH_START_ROUND + benchSeen++]);

  const changed = planned.filter(([p, r]) => p.round_number !== r);
  const before = mine.map((p) => p.round_number).join(",");
  const after = [...planned.map(([, r]) => r), ...Array.from({ length: added }, (_, i) => OPEN_ROUNDS - added + 1 + i)]
    .sort((a, b) => a - b)
    .join(",");

  const openRows = planned.filter(([, r]) => r <= OPEN_ROUNDS).length + added;
  let flag = "";
  if (added > 0) flag = `  [+${added} missing pushback skip row${added > 1 ? "s" : ""}]`;
  if (cryptoSpent < CRYPTO_POOL) {
    flag = `  [!! only $${cryptoSpent.toLocaleString()} of $200,000 crypto spent — NOT repaired, needs your call]`;
    needsDecision.push({ team: m.display_name, spent: cryptoSpent });
  }

  say(`  ${m.display_name.padEnd(22)} ${changed.length ? `${changed.length} renumbered` : "rounds already correct"}${flag}`);
  say(`      before: ${before}`);
  say(`      after : ${after}   (${openRows}/13 open rounds)`);
  renumbers.push(...changed.map(([p, r]) => ({ id: p.id, round: r })));
}

if (APPLY) {
  for (const r of renumbers) {
    const { error } = await sb
      .from("draft_picks")
      .update({ round_number: r.round })
      .eq("id", r.id);
    if (error) throw new Error(`pick ${r.id}: ${error.message}`);
  }
  if (renumbers.length) say(`\n  -> renumbered ${renumbers.length} picks`);
  if (newSkips.length) {
    const { error } = await sb.from("draft_picks").insert(newSkips);
    if (error) throw new Error(`insert skip rows: ${error.message}`);
    say(`  -> inserted ${newSkips.length} missing pushback skip rows`);
  }
} else if (newSkips.length) {
  say(`\n  would insert ${newSkips.length} missing pushback skip rows`);
}

if (needsDecision.length) {
  banner("LEFT ALONE — needs your decision");
  for (const d of needsDecision) {
    say(`  ${d.team}: $${(CRYPTO_POOL - d.spent).toLocaleString()} of crypto budget never spent`);
  }
}

banner(APPLY ? "DONE — changes applied" : "DRY RUN COMPLETE — re-run with --apply to write");
