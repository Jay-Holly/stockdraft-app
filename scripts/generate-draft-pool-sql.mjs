/**
 * Fetches current S&P 500 constituents and writes supabase/migrations/004_draft_pool.sql
 * Source: https://github.com/datasets/s-and-p-500-companies
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CSV_URL =
  "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv";

/** Map GICS sector labels from the dataset to our 11 display sectors. */
const SECTOR_MAP = {
  "Information Technology": "Technology",
  "Health Care": "Healthcare",
  Financials: "Financials",
  "Consumer Discretionary": "Consumer Discretionary",
  "Consumer Staples": "Consumer Staples",
  Energy: "Energy",
  Industrials: "Industrials",
  Materials: "Materials",
  "Real Estate": "Real Estate",
  Utilities: "Utilities",
  "Communication Services": "Communication Services",
};

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

function escapeSql(value) {
  return value.replace(/'/g, "''");
}

async function main() {
  const res = await fetch(CSV_URL);
  if (!res.ok) throw new Error(`Failed to fetch CSV: ${res.status}`);
  const text = await res.text();
  const lines = text.trim().split("\n");
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const [symbol, name, gicsSector] = parseCsvLine(lines[i]);
    if (!symbol || !name || !gicsSector) continue;

    const sector = SECTOR_MAP[gicsSector.trim()];
    if (!sector) {
      throw new Error(`Unknown GICS sector: ${gicsSector} (${symbol})`);
    }

    rows.push({
      symbol: symbol.trim().toUpperCase(),
      name: name.trim(),
      sector,
    });
  }

  rows.sort((a, b) => a.symbol.localeCompare(b.symbol));

  const values = rows
    .map(
      (r) =>
        `  ('${escapeSql(r.symbol)}', '${escapeSql(r.name)}', '${escapeSql(r.sector)}')`
    )
    .join(",\n");

  const sql = `-- Phase 4c: S&P 500 draft pool (default browsable universe)
-- Generated from ${CSV_URL}
-- ${rows.length} constituents as of generation time

create table if not exists public.draft_pool (
  symbol text primary key,
  name text not null,
  sector text not null check (
    sector in (
      'Technology',
      'Financials',
      'Healthcare',
      'Consumer Discretionary',
      'Consumer Staples',
      'Energy',
      'Industrials',
      'Materials',
      'Real Estate',
      'Utilities',
      'Communication Services'
    )
  ),
  updated_at timestamptz not null default now()
);

create index if not exists draft_pool_sector_idx on public.draft_pool (sector);
create index if not exists draft_pool_name_idx on public.draft_pool (name);

alter table public.draft_pool enable row level security;

drop policy if exists "draft_pool_read_authenticated" on public.draft_pool;
create policy "draft_pool_read_authenticated"
  on public.draft_pool
  for select
  to authenticated
  using (true);

-- Refresh seed data idempotently
truncate public.draft_pool;

insert into public.draft_pool (symbol, name, sector) values
${values};
`;

  const outPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "supabase",
    "migrations",
    "004_draft_pool.sql"
  );

  writeFileSync(outPath, sql, "utf8");
  console.log(`Wrote ${rows.length} stocks to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
