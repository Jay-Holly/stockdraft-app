-- Cached stock and crypto quotes refreshed by Vercel cron jobs.

create table if not exists public.stock_prices (
  symbol text primary key,
  price numeric not null check (price >= 0),
  change_percent numeric not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists stock_prices_updated_at_idx
  on public.stock_prices (updated_at desc);

alter table public.stock_prices enable row level security;

drop policy if exists "stock_prices_read_authenticated" on public.stock_prices;
create policy "stock_prices_read_authenticated"
  on public.stock_prices
  for select
  to authenticated
  using (true);

drop policy if exists "stock_prices_service_write" on public.stock_prices;
create policy "stock_prices_service_write"
  on public.stock_prices
  for all
  to service_role
  using (true)
  with check (true);

create table if not exists public.crypto_prices (
  symbol text primary key,
  price numeric not null check (price >= 0),
  change_percent numeric not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists crypto_prices_updated_at_idx
  on public.crypto_prices (updated_at desc);

alter table public.crypto_prices enable row level security;

drop policy if exists "crypto_prices_read_authenticated" on public.crypto_prices;
create policy "crypto_prices_read_authenticated"
  on public.crypto_prices
  for select
  to authenticated
  using (true);

drop policy if exists "crypto_prices_service_write" on public.crypto_prices;
create policy "crypto_prices_service_write"
  on public.crypto_prices
  for all
  to service_role
  using (true)
  with check (true);
