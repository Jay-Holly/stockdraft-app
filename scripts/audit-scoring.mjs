#!/usr/bin/env node
/**
 * Scoring integrity audit — read-only.
 *
 * Answers one question: does every finalized game reproduce from the baseline
 * data stored underneath it? A score that can't be re-derived from its own
 * open/close values is not verifiable, whatever it says on the standings page.
 *
 * Checks:
 *   1. Chain continuity  — a week's open must equal the prior week's close.
 *   2. Bogus ties        — 0.00/0.00 finals (roster load failed, scored as a tie).
 *   3. Orphan finals     — a scored game with no usable baselines beneath it.
 *   4. Score drift       — stored score disagrees with its own baselines.
 *   5. Implausible moves — a single period swinging more than MAX_ABS_PCT_CHANGE.
 *
 * Usage:  node scripts/audit-scoring.mjs [--league <uuid|name-fragment>] [--verbose]
 * Writes nothing. Safe to run against production at any time.
 */

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    const key = line.slice(0, index);
    const value = line.slice(index + 1).replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvFile(path.join(process.cwd(), ".env.local"));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (checked .env.local)."
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const VERBOSE = args.includes("--verbose");
const leagueFilterIdx = args.indexOf("--league");
const LEAGUE_FILTER =
  leagueFilterIdx !== -1 ? args[leagueFilterIdx + 1]?.toLowerCase() : null;

/** Matches MAX_ABS_PCT_CHANGE in src/lib/market/quote-guards.ts. */
const MAX_ABS_PCT_CHANGE = 500;
/** A score within this many points of its recomputation counts as reproducing. */
const SCORE_TOLERANCE = 0.5;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

/** PostgREST caps a select at 1000 rows — every read here must paginate. */
async function pageAll(table, select) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .range(offset, offset + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

const near = (a, b) => Math.abs(a - b) < 0.01;
const pct = (open, close) => (open > 0 ? ((close - open) / open) * 100 : null);

async function main() {
  console.log("\nScoring integrity audit (read-only)\n");

  const [leagues, picks, baselines, matchups, moves] = await Promise.all([
    pageAll("leagues", "id, name, scoring_mode, format_type, status"),
    pageAll("draft_picks", "id, symbol, pick_type"),
    pageAll(
      "roster_week_baselines",
      "league_id, user_id, week_number, pick_id, value_at_open, value_at_close"
    ),
    pageAll(
      "league_matchups",
      "id, league_id, week_number, status, home_user_id, away_user_id, home_score, away_score, winner_user_id"
    ),
    pageAll("roster_moves", "pick_id"),
  ]);

  const leagueById = new Map(leagues.map((l) => [l.id, l]));
  const pickById = new Map(picks.map((p) => [p.id, p]));
  const movedPicks = new Set(moves.map((m) => m.pick_id));

  const inScope = (leagueId) => {
    if (!LEAGUE_FILTER) return true;
    const l = leagueById.get(leagueId);
    return (
      leagueId.toLowerCase() === LEAGUE_FILTER ||
      (l?.name ?? "").toLowerCase().includes(LEAGUE_FILTER)
    );
  };

  const scopedBaselines = baselines.filter((b) => inScope(b.league_id));
  const scopedMatchups = matchups.filter((m) => inScope(m.league_id));

  const leagueName = (id) => leagueById.get(id)?.name ?? id.slice(0, 8);

  // A bench/IR/empty slot doesn't contribute to a team's score.
  const contributes = (b) => {
    const p = pickById.get(b.pick_id);
    return (
      p &&
      p.pick_type !== "bench" &&
      p.pick_type !== "ir" &&
      p.symbol.toUpperCase() !== "__OPEN__"
    );
  };

  const slotKey = (b) => `${b.league_id}:${b.user_id}:${b.pick_id}`;
  const weekKey = (l, u, w) => `${l}:${u}:${w}`;

  const bySlot = new Map();
  const byWeek = new Map();
  for (const b of scopedBaselines) {
    const s = slotKey(b);
    if (!bySlot.has(s)) bySlot.set(s, []);
    bySlot.get(s).push(b);

    const w = weekKey(b.league_id, b.user_id, b.week_number);
    if (!byWeek.has(w)) byWeek.set(w, []);
    byWeek.get(w).push(b);
  }

  const findings = { chain: [], ties: [], orphans: [], drift: [], implausible: [] };

  // 1. Chain continuity.
  for (const rows of bySlot.values()) {
    rows.sort((a, b) => a.week_number - b.week_number);
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const cur = rows[i];
      if (prev.value_at_close == null || cur.value_at_open == null) continue;
      if (cur.week_number !== prev.week_number + 1) continue;
      if (near(Number(prev.value_at_close), Number(cur.value_at_open))) continue;
      // A pick that changed hands has a legitimate acquisition-time baseline.
      if (movedPicks.has(cur.pick_id)) continue;
      findings.chain.push({
        league: cur.league_id,
        symbol: pickById.get(cur.pick_id)?.symbol ?? "?",
        fromWeek: prev.week_number,
        toWeek: cur.week_number,
        close: Number(prev.value_at_close),
        open: Number(cur.value_at_open),
      });
    }
  }

  // 5. Implausible single-period moves.
  for (const b of scopedBaselines) {
    if (b.value_at_open == null || b.value_at_close == null) continue;
    const move = pct(Number(b.value_at_open), Number(b.value_at_close));
    if (move != null && Math.abs(move) > MAX_ABS_PCT_CHANGE) {
      findings.implausible.push({
        league: b.league_id,
        symbol: pickById.get(b.pick_id)?.symbol ?? "?",
        week: b.week_number,
        move,
      });
    }
  }

  // Recompute a team's week from the baselines stored beneath it.
  const recompute = (leagueId, userId, week) => {
    const rows = (byWeek.get(weekKey(leagueId, userId, week)) ?? []).filter(
      contributes
    );
    let open = 0;
    let close = 0;
    let n = 0;
    for (const b of rows) {
      if (b.value_at_open == null || b.value_at_close == null) continue;
      open += Number(b.value_at_open);
      close += Number(b.value_at_close);
      n++;
    }
    return n === 0 ? null : { pct: pct(open, close), n };
  };

  // 2-4. Finalized games versus their own data.
  const finals = scopedMatchups.filter(
    (m) => m.status === "complete" && m.home_score != null
  );
  let reproduces = 0;

  for (const m of finals) {
    const stored = { home: Number(m.home_score), away: Number(m.away_score) };

    if (stored.home === 0 && stored.away === 0) {
      findings.ties.push({
        league: m.league_id,
        week: m.week_number,
        noWinner: !m.winner_user_id,
      });
      continue;
    }

    const home = recompute(m.league_id, m.home_user_id, m.week_number);
    const away = recompute(m.league_id, m.away_user_id, m.week_number);

    if (!home || !away || home.pct == null || away.pct == null) {
      findings.orphans.push({ league: m.league_id, week: m.week_number });
      continue;
    }

    const dh = home.pct - stored.home;
    const da = away.pct - stored.away;
    if (Math.abs(dh) < SCORE_TOLERANCE && Math.abs(da) < SCORE_TOLERANCE) {
      reproduces++;
      continue;
    }

    const storedWinnerIsHome = stored.home > stored.away;
    findings.drift.push({
      league: m.league_id,
      week: m.week_number,
      stored,
      recomputed: { home: home.pct, away: away.pct },
      flips: storedWinnerIsHome !== home.pct > away.pct,
    });
  }

  // Report.
  const line = (label, count, detail = "") =>
    console.log(`  ${label.padEnd(34)} ${String(count).padStart(5)}  ${detail}`);

  console.log(`Scope: ${LEAGUE_FILTER ? `leagues matching "${LEAGUE_FILTER}"` : "all leagues"}`);
  console.log(
    `Data:  ${scopedBaselines.length} baselines, ${finals.length} finalized games\n`
  );

  console.log("Finalized games");
  line("reproduce from their baselines", reproduces);
  line("recorded 0.00 / 0.00", findings.ties.length, findings.ties.filter((t) => t.noWinner).length + " with no winner");
  line("no usable baselines", findings.orphans.length);
  line("drift from their baselines", findings.drift.length, findings.drift.filter((d) => d.flips).length + " would flip winner");

  console.log("\nBaseline integrity");
  line("broken week-to-week chains", findings.chain.length);
  line(`single-week moves over ${MAX_ABS_PCT_CHANGE}%`, findings.implausible.length);

  if (VERBOSE) {
    const show = (title, rows, fmt) => {
      if (!rows.length) return;
      console.log(`\n${title}`);
      rows.slice(0, 50).forEach((r) => console.log(`  ${fmt(r)}`));
      if (rows.length > 50) console.log(`  ... and ${rows.length - 50} more`);
    };
    show("Broken chains", findings.chain, (r) =>
      `${leagueName(r.league).slice(0, 24).padEnd(24)} ${String(r.symbol).padEnd(6)} w${r.fromWeek}->w${r.toWeek}  close=${r.close.toFixed(2)} open=${r.open.toFixed(2)}`
    );
    show("Bogus ties", findings.ties, (r) =>
      `${leagueName(r.league).slice(0, 24).padEnd(24)} week ${r.week}${r.noWinner ? "  (no winner)" : ""}`
    );
    show("Orphan finals", findings.orphans, (r) =>
      `${leagueName(r.league).slice(0, 24).padEnd(24)} week ${r.week}`
    );
    show("Score drift", findings.drift, (r) =>
      `${leagueName(r.league).slice(0, 24).padEnd(24)} week ${String(r.week).padStart(2)}  stored ${r.stored.home.toFixed(2)}/${r.stored.away.toFixed(2)}  recomputed ${r.recomputed.home.toFixed(2)}/${r.recomputed.away.toFixed(2)}${r.flips ? "  FLIPS WINNER" : ""}`
    );
    show("Implausible moves", findings.implausible, (r) =>
      `${leagueName(r.league).slice(0, 24).padEnd(24)} ${String(r.symbol).padEnd(6)} week ${r.week}  ${r.move.toFixed(1)}%`
    );
  } else {
    console.log("\n(run with --verbose for per-row detail)");
  }

  const problems =
    findings.chain.length +
    findings.ties.length +
    findings.orphans.length +
    findings.drift.length +
    findings.implausible.length;

  console.log(
    problems === 0
      ? "\nClean — every finalized game reproduces from its own data.\n"
      : `\n${problems} issue(s) found. Nothing was written.\n`
  );

  process.exitCode = problems === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(`Audit failed: ${error.message}`);
  process.exit(2);
});
