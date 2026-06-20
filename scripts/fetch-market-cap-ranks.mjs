/**
 * Fetches market cap via Finnhub profile2 for S&P 500 symbols and writes
 * src/data/sp500-market-cap-ranks.json (symbol -> rank, 1 = largest).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CSV_URL =
  "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv";

function loadFinnhubKey() {
  try {
    const env = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", ".env.local"), "utf8");
    const match = env.match(/NEXT_PUBLIC_FINNHUB_KEY=(.+)/);
    return match?.[1]?.trim();
  } catch {
    return process.env.NEXT_PUBLIC_FINNHUB_KEY;
  }
}

function parseCsvLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      fields.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  fields.push(current);
  return fields;
}

async function fetchMarketCap(symbol, token) {
  const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${token}`;
  const res = await fetch(url);
  if (!res.ok) return 0;
  const data = await res.json();
  return typeof data.marketCapitalization === "number"
    ? data.marketCapitalization
    : 0;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const token = loadFinnhubKey();
  if (!token) throw new Error("NEXT_PUBLIC_FINNHUB_KEY required");

  const csvRes = await fetch(CSV_URL);
  if (!csvRes.ok) throw new Error(`CSV fetch failed: ${csvRes.status}`);
  const lines = (await csvRes.text()).trim().split("\n");
  const symbols = [];

  for (let i = 1; i < lines.length; i++) {
    const [symbol] = parseCsvLine(lines[i]);
    if (symbol) symbols.push(symbol.trim().toUpperCase());
  }

  const caps = [];

  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];
    let marketCap = 0;

    for (let attempt = 0; attempt < 3 && marketCap <= 0; attempt++) {
      marketCap = await fetchMarketCap(symbol, token);
      if (marketCap <= 0) await sleep(500);
    }

    caps.push({ symbol, marketCap });
    process.stdout.write(`\r${i + 1}/${symbols.length} ${symbol}`);
    await sleep(300);
  }

  console.log("\nRanking…");

  caps.sort((a, b) => b.marketCap - a.marketCap);

  const ranks = {};
  caps.forEach((row, index) => {
    ranks[row.symbol] = index + 1;
  });

  const outPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "src",
    "data",
    "sp500-market-cap-ranks.json"
  );

  writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: "Finnhub profile2 marketCapitalization (USD millions)",
        ranks,
      },
      null,
      2
    ),
    "utf8"
  );

  const top10 = caps.slice(0, 10).map((r) => `${r.symbol} ($${r.marketCap}M)`);
  console.log(`Wrote ${Object.keys(ranks).length} ranks to ${outPath}`);
  console.log("Top 10:", top10.join(", "));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
