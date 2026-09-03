/**
 * Fetches Bleacher Report's "NFL 1000" player finder tool (an embedded
 * iframe on the B/R NFL 1000 article, not a documented API) and writes
 * src/data/br-nfl1000-2026-ranks.json (rank 1-1000 -> name/position/team).
 *
 * The tool's markup is a flat wall of <div class="n1k-card" data-rank=...>
 * elements — one per player, with data-rank/data-pos/data-team attributes
 * and the name in a <b class="n1k-name">. This script scrapes that markup
 * directly since there's no JSON endpoint behind it.
 *
 * Source page: https://bleacherreport.com/articles/25460002 (embeds the
 * tool via <iframe src="https://nfl-1000-lookup-only.jason-dunbar.workers.dev/">)
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOL_URL = "https://nfl-1000-lookup-only.jason-dunbar.workers.dev/";

function attr(card, name) {
  const m = card.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : null;
}

function find(pattern, card) {
  const m = card.match(pattern);
  return m ? m[1].trim() : null;
}

async function main() {
  console.log(`Fetching ${TOOL_URL}...`);
  const res = await fetch(TOOL_URL);
  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  }
  const html = await res.text();

  const cards = html
    .split(/(?=<div class="n1k-card")/)
    .filter((c) => c.startsWith('<div class="n1k-card"'));

  if (cards.length !== 1000) {
    console.warn(`Warning: expected 1000 cards, found ${cards.length}.`);
  }

  const players = cards
    .map((c) => {
      const rank = Number(attr(c, "data-rank"));
      const name = find(/class="n1k-name"[^>]*>([^<]*)</, c);
      return {
        rank,
        name,
        position: attr(c, "data-pos"),
        team: attr(c, "data-team"),
        teamname: attr(c, "data-teamname"),
        conf: attr(c, "data-conf"),
      };
    })
    .filter((p) => Number.isFinite(p.rank) && p.name)
    .sort((a, b) => a.rank - b.rank);

  const ranks = new Set(players.map((p) => p.rank));
  if (ranks.size !== players.length) {
    throw new Error("Duplicate ranks found in scraped data — aborting.");
  }
  const missing = [];
  for (let r = 1; r <= 1000; r++) {
    if (!ranks.has(r)) missing.push(r);
  }
  if (missing.length > 0) {
    console.warn(`Warning: missing ranks: ${missing.slice(0, 20).join(", ")}${missing.length > 20 ? "…" : ""}`);
  }

  const outPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "src",
    "data",
    "br-nfl1000-2026-ranks.json"
  );

  writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: "Bleacher Report NFL 1000 player finder tool (embedded iframe, not a public API)",
        sourceArticle: "https://bleacherreport.com/articles/25460002-br-nfl-1000-ranking-top-1000-players-2026-season",
        toolUrl: TOOL_URL,
        players,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(`Wrote ${players.length} ranked players to ${outPath}`);
  console.log("Top 5:", players.slice(0, 5).map((p) => `${p.rank}. ${p.name} (${p.position}, ${p.team})`).join(" | "));
  console.log("700:", players.find((p) => p.rank === 700));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
