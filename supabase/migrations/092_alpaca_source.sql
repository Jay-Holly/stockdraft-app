-- 092_alpaca_source.sql
--
-- Adds 'alpaca' as a valid price_log source, now that it's wired in as the
-- primary equities provider (2026-08-29) — one batch call prices the whole
-- pool, Finnhub falls back for whatever it misses.

begin;

alter table public.price_log drop constraint if exists price_log_source_check;
alter table public.price_log add constraint price_log_source_check
  check (source in ('finnhub', 'coingecko', 'twelvedata', 'alpaca', 'manual'));

commit;
