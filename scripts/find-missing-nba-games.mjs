#!/usr/bin/env node
// Cross-references each IST-affected team's real 82-game log from
// Basketball-Reference against our sim_game_results to find exactly which
// real regular-season games are missing (ESPN's schedule API is
// incomplete for these teams), so we can insert the makeup rows.
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

const TEAM_NAME_TO_ABBREV = {
  "Atlanta Hawks": "ATL",
  "Boston Celtics": "BOS",
  "Brooklyn Nets": "BKN",
  "Charlotte Hornets": "CHA",
  "Chicago Bulls": "CHI",
  "Cleveland Cavaliers": "CLE",
  "Dallas Mavericks": "DAL",
  "Denver Nuggets": "DEN",
  "Detroit Pistons": "DET",
  "Golden State Warriors": "GSW",
  "Houston Rockets": "HOU",
  "Indiana Pacers": "IND",
  "LA Clippers": "LAC",
  "Los Angeles Clippers": "LAC",
  "Los Angeles Lakers": "LAL",
  "Memphis Grizzlies": "MEM",
  "Miami Heat": "MIA",
  "Milwaukee Bucks": "MIL",
  "Minnesota Timberwolves": "MIN",
  "New Orleans Pelicans": "NOP",
  "New York Knicks": "NYK",
  "Oklahoma City Thunder": "OKC",
  "Orlando Magic": "ORL",
  "Philadelphia 76ers": "PHI",
  "Phoenix Suns": "PHX",
  "Portland Trail Blazers": "POR",
  "Sacramento Kings": "SAC",
  "San Antonio Spurs": "SAS",
  "Toronto Raptors": "TOR",
  "Utah Jazz": "UTA",
  "Washington Wizards": "WAS",
};

// Basketball-Reference team codes (differ from ours only for CHO/PHO, not
// relevant to any of our target teams below).
const BREF_CODE = {
  ATL: "ATL", DAL: "DAL", GSW: "GSW", HOU: "HOU",
  MIL: "MIL", NYK: "NYK", OKC: "OKC", ORL: "ORL",
};

async function fetchTeamGames(bref) {
  const res = await fetch(
    `https://www.basketball-reference.com/teams/${bref}/2025_games.html`,
    { headers: { "User-Agent": "Mozilla/5.0" } }
  );
  if (!res.ok) throw new Error(`bref fetch failed for ${bref}: HTTP ${res.status}`);
  const html = await res.text();

  // Parse the regular-season games table (id="games") row by row.
  const tableMatch = html.match(/<table[^>]*id="games"[\s\S]*?<\/table>/);
  if (!tableMatch) throw new Error(`no games table found for ${bref}`);
  const table = tableMatch[0];

  const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
  const games = [];
  for (const row of rows) {
    if (!row.includes('data-stat="date_game"')) continue; // header/separator row
    const dateMatch = row.match(/data-stat="date_game"[^>]*csk="([^"]*)"/);
    const homeAwayMatch = row.match(/data-stat="game_location"[^>]*>([^<]*)</);
    const oppMatch = row.match(/data-stat="opp_name"[^>]*>(?:<a[^>]*>)?([^<]+)/);
    if (!dateMatch || !oppMatch) continue;

    const gameDate = dateMatch[1];
    const opponentName = oppMatch[1].trim();
    const opponentAbbrev = TEAM_NAME_TO_ABBREV[opponentName];
    const isAway = (homeAwayMatch?.[1] ?? "").trim() === "@";
    if (!gameDate || !opponentAbbrev) continue;

    games.push({ gameDate, opponentAbbrev, isAway });
  }
  return games;
}

async function main() {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const missing = [];

  for (const team of Object.keys(BREF_CODE)) {
    const realGames = await fetchTeamGames(BREF_CODE[team]);
    console.log(`${team}: ${realGames.length} real games from Basketball-Reference`);

    const { rows: dbRows } = await client.query(
      `select game_date, home_team, away_team from sim_game_results
       where sport='nba' and season='2024' and (home_team=$1 or away_team=$1)`,
      [team]
    );
    const dbKeys = new Set(
      dbRows.map(
        (r) => `${r.game_date.toISOString().slice(0, 10)}|${r.home_team}|${r.away_team}`
      )
    );

    for (const game of realGames) {
      const homeTeam = game.isAway ? game.opponentAbbrev : team;
      const awayTeam = game.isAway ? team : game.opponentAbbrev;
      const key = `${game.gameDate}|${homeTeam}|${awayTeam}`;
      if (!dbKeys.has(key)) {
        missing.push({ gameDate: game.gameDate, homeTeam, awayTeam });
      }
    }

    // Be polite to basketball-reference.
    await new Promise((r) => setTimeout(r, 3000));
  }

  console.log(`\nMissing games (${missing.length}):`);
  const seen = new Set();
  const dedup = [];
  for (const g of missing) {
    const key = `${g.gameDate}|${g.homeTeam}|${g.awayTeam}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(g);
  }
  for (const g of dedup) {
    console.log(`  ${g.gameDate} ${g.homeTeam} vs ${g.awayTeam}`);
  }

  fs.writeFileSync(
    path.join(process.cwd(), "scripts/.missing-nba-games.json"),
    JSON.stringify(dedup, null, 2)
  );
  console.log(`\nWrote ${dedup.length} rows to scripts/.missing-nba-games.json`);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
