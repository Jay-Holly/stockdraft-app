/**
 * Fetches Finnhub quotes for S&P 500 symbols and writes fallback snapshot JSON.
 * Used when live Finnhub batch requests fail or rate-limit.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function loadFinnhubKey() {
  try {
    const env = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", ".env.local"),
      "utf8"
    );
    const match = env.match(/NEXT_PUBLIC_FINNHUB_KEY=(.+)/);
    return match?.[1]?.trim();
  } catch {
    return process.env.NEXT_PUBLIC_FINNHUB_KEY;
  }
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchQuote(symbol, token) {
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${token}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        await sleep(400);
        continue;
      }
      const data = await res.json();
      const price = data.c ?? 0;
      const prevClose = data.pc ?? price;
      if (price <= 0) {
        await sleep(400);
        continue;
      }
      const changePercent =
        prevClose === 0 ? 0 : ((price - prevClose) / prevClose) * 100;
      return { price, prevClose, changePercent };
    } catch {
      await sleep(400);
    }
  }
  return null;
}

async function main() {
  const token = loadFinnhubKey();
  if (!token) throw new Error("NEXT_PUBLIC_FINNHUB_KEY required");

  const ranksPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "src",
    "data",
    "sp500-market-cap-ranks.json"
  );
  const ranksData = JSON.parse(readFileSync(ranksPath, "utf8"));
  const symbols = Object.keys(ranksData.ranks).sort();

  const quotes = {};

  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];
    const quote = await fetchQuote(symbol, token);
    if (quote) quotes[symbol] = quote;
    process.stdout.write(`\r${i + 1}/${symbols.length} ${symbol}`);
    await sleep(250);
  }

  const outPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "src",
    "data",
    "sp500-fallback-quotes.json"
  );

  writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: "Finnhub /quote snapshot for S&P 500 pool fallback",
        quotes,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(`\nWrote ${Object.keys(quotes).length} quotes to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
