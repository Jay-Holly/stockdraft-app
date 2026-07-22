#!/usr/bin/env node
// Repairs the 19 real MLB doubleheaders wrongly collapsed to a single row
// by dedupe-mlb-game-results.mjs (which didn't know about MLB's gameNumber
// disambiguator, added in migration 068). For each affected date+matchup,
// deletes the single surviving row and re-inserts both real legs, tagged
// with the correct game_number, straight from MLB StatsAPI. Dry-run by
// default; pass --execute to write.
import fs from "node:fs";
import path from "node:path";

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
const dbUrl = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
const execute = process.argv.includes("--execute");

// Confirmed via MLB StatsAPI: real doubleheaders (2 legs each), except the
// last (ATL vs CIN 9/9) which was a true duplicate insert, already handled.
const DOUBLEHEADER_DATES = [
  ["2024-09-30", "ATL", "NYM"],
  ["2024-04-04", "NYM", "DET"],
  ["2024-06-16", "MIN", "OAK"],
  ["2024-07-10", "STL", "KC"],
  ["2024-04-21", "COL", "SEA"],
  ["2024-05-29", "DET", "PIT"],
  ["2024-08-26", "CLE", "KC"],
  ["2024-06-26", "STL", "ATL"],
  ["2024-04-30", "DET", "STL"],
  ["2024-08-30", "CIN", "MIL"],
  ["2024-08-09", "MIN", "CLE"],
  ["2024-05-20", "ATL", "SD"],
  ["2024-08-07", "CLE", "AZ"],
  ["2024-09-07", "PIT", "WSH"],
  ["2024-07-29", "BAL", "TOR"],
  ["2024-07-13", "STL", "CHC"],
  ["2024-04-17", "CWS", "KC"],
  ["2024-04-13", "CLE", "NYY"],
  ["2024-05-14", "CWS", "WSH"],
];

const ABBREV_TO_MLB_ID = {
  ATL: 144, AZ: 109, BAL: 110, BOS: 111, CHC: 112, CIN: 113, CLE: 114,
  COL: 115, CWS: 145, DET: 116, HOU: 117, KC: 118, LAA: 108, LAD: 119,
  MIA: 146, MIL: 158, MIN: 142, NYM: 121, NYY: 147, OAK: 133, PHI: 143,
  PIT: 134, SD: 135, SEA: 136, SF: 137, STL: 138, TB: 139, TEX: 140,
  TOR: 141, WSH: 120,
};

async function main() {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const toInsert = [];
  const toDeleteIds = [];

  for (const [date, home, away] of DOUBLEHEADER_DATES) {
    const homeId = ABBREV_TO_MLB_ID[home];
    const res = await fetch(
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${date}&endDate=${date}&gameType=R&season=2024&teamId=${homeId}`
    );
    const data = await res.json();
    const games = (data.dates ?? []).flatMap((d) => d.games ?? []);
    const legs = games.filter((g) => g.status?.abstractGameState === "Final");

    if (legs.length !== 2) {
      console.warn(`  SKIP ${date} ${home} vs ${away}: expected 2 legs, found ${legs.length}`);
      continue;
    }

    const { rows: existing } = await client.query(
      `select id from sim_game_results where sport='mlb' and season='2024' and game_date=$1 and home_team=$2 and away_team=$3`,
      [date, home, away]
    );
    toDeleteIds.push(...existing.map((r) => r.id));

    for (const g of legs) {
      const homeScore = Number(g.teams?.home?.score);
      const awayScore = Number(g.teams?.away?.score);
      let winningTeam = null;
      let losingTeam = null;
      if (homeScore > awayScore) {
        winningTeam = home;
        losingTeam = away;
      } else if (awayScore > homeScore) {
        winningTeam = away;
        losingTeam = home;
      }
      toInsert.push({
        sport: "mlb",
        season: "2024",
        week: null,
        game_date: date,
        game_number: g.gameNumber,
        home_team: home,
        away_team: away,
        winning_team: winningTeam,
        losing_team: losingTeam,
        home_score: Number.isFinite(homeScore) ? homeScore : null,
        away_score: Number.isFinite(awayScore) ? awayScore : null,
      });
    }

    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`\nWill delete ${toDeleteIds.length} existing rows, insert ${toInsert.length} rows.`);
  console.log("Sample inserts:", toInsert.slice(0, 4));

  if (!execute) {
    console.log("\nDry run only — pass --execute to actually write.");
    await client.end();
    return;
  }

  if (toDeleteIds.length > 0) {
    await client.query(`delete from sim_game_results where id = any($1::bigint[])`, [toDeleteIds]);
  }
  for (const row of toInsert) {
    await client.query(
      `insert into sim_game_results (sport, season, week, game_date, game_number, home_team, away_team, winning_team, losing_team, home_score, away_score)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [row.sport, row.season, row.week, row.game_date, row.game_number, row.home_team, row.away_team, row.winning_team, row.losing_team, row.home_score, row.away_score]
    );
  }
  console.log(`Deleted ${toDeleteIds.length}, inserted ${toInsert.length}.`);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
