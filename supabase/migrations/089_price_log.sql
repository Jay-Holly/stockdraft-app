-- 089_price_log.sql
--
-- The price log.
--
-- One append-only record of every price observation this system has ever made,
-- and the only place prices are read from. Nothing outside the logger writes
-- here; nothing anywhere fetches a price from a provider directly.
--
-- The rules below are database constraints, not conventions, because every
-- incident this system has had came from a convention that held everywhere
-- except the one path nobody remembered to check:
--
--   * A row is EITHER a price OR a failure. Never both, never neither.
--   * A price is never zero. Postgres rejects it. The "$0 baseline scored the
--     week as -100%" bug cannot be stored, let alone read back and summed.
--   * A price cannot exist without the moment it was true.
--   * A hand-edit always records who made it and what it replaced.
--
-- Retention: `sample` rows are prunable. `open` and `close` rows are the
-- scoring record and are kept.

begin;

-- ---------------------------------------------------------------------------
-- A single run of the logger.
-- ---------------------------------------------------------------------------
create table if not exists public.price_sweep (
  id                bigint generated always as identity primary key,

  kind              text not null check (kind in ('open', 'close', 'sample')),
  asset_class       text not null check (asset_class in ('stock', 'crypto', 'all')),
  -- The US trading day (Eastern) this sweep belongs to.
  session_date      date not null,

  -- 'partial' is the state the old system could not express: it finished, but
  -- it did not get everything. Previously that was reported as success.
  status            text not null default 'running'
                      check (status in ('running', 'complete', 'partial', 'failed', 'aborted')),

  started_at        timestamptz not null default now(),
  finished_at       timestamptz,

  symbols_requested integer not null default 0,
  symbols_ok        integer not null default 0,
  symbols_failed    integer not null default 0,
  -- Feeds the admin Health panel: how much provider budget today has cost.
  api_calls         integer not null default 0,

  triggered_by      text not null check (triggered_by in ('cron', 'manual')),
  triggered_by_user uuid references public.profiles(id) on delete set null,
  error             text
);

create index if not exists price_sweep_session_idx
  on public.price_sweep (session_date desc, started_at desc);
create index if not exists price_sweep_running_idx
  on public.price_sweep (started_at desc) where status = 'running';

-- ---------------------------------------------------------------------------
-- Every observation, successful or not.
-- ---------------------------------------------------------------------------
create table if not exists public.price_log (
  id              bigint generated always as identity primary key,

  symbol          text not null,
  asset_class     text not null check (asset_class in ('stock', 'crypto')),

  -- Exactly one of price / failure_reason is set (see price_xor_failure).
  price           numeric(20, 8) check (price is null or price > 0),
  failure_reason  text check (failure_reason in (
                    'no-quote', 'too-stale', 'rate-limited',
                    'provider-error', 'frozen', 'not-attempted')),

  change_percent  numeric(12, 6),

  -- The day's high and low, when the provider supplies them. Finnhub returns
  -- both in the same call that gives the price, so they cost nothing extra.
  -- Not decoration: the SDPL/SDAI "Diamond Hands" award scores the biggest
  -- recovery swing on a stock held all period, which cannot be computed from
  -- an open and a close alone. Without these the award is either unscoreable
  -- or quietly wrong, and quietly wrong is the failure mode this table exists
  -- to prevent.
  day_high        numeric(20, 8) check (day_high is null or day_high > 0),
  day_low         numeric(20, 8) check (day_low  is null or day_low  > 0),

  -- 'open' and 'close' are the anchors contests score on. 'sample' is the
  -- running price during the day, for trading and live standings.
  kind            text not null check (kind in ('open', 'close', 'sample')),
  session_date    date not null,

  -- When the price was true at its source, never when we read it.
  as_of           timestamptz,
  -- When we wrote it down.
  captured_at     timestamptz not null default now(),

  source          text not null check (source in (
                    'finnhub', 'coingecko', 'twelvedata', 'manual')),

  sweep_id        bigint references public.price_sweep(id) on delete set null,

  -- Hand-edit trail. A corrected anchor supersedes the old row rather than
  -- overwriting it, so what the provider actually said stays visible forever.
  set_by          uuid references public.profiles(id) on delete set null,
  replaced_price  numeric(20, 8),
  note            text,
  superseded_at   timestamptz,
  superseded_by   bigint references public.price_log(id) on delete set null,

  -- A failure can never be a number, and a number is never a failure.
  constraint price_xor_failure check (
    (price is not null and failure_reason is null) or
    (price is null     and failure_reason is not null)
  ),
  -- A price without the moment it was true is unusable for scoring.
  constraint priced_needs_asof check (price is null or as_of is not null),
  -- A hand-edit always knows who made it.
  constraint manual_needs_author check (source <> 'manual' or set_by is not null)
);

-- At most one live open and one live close per symbol per day. Failed attempts
-- and superseded corrections are unconstrained, so retrying is always allowed.
create unique index if not exists price_log_anchor_unique
  on public.price_log (symbol, session_date, kind)
  where kind in ('open', 'close') and price is not null and superseded_at is null;

create index if not exists price_log_symbol_day_idx
  on public.price_log (symbol, session_date, kind);
create index if not exists price_log_latest_idx
  on public.price_log (symbol, captured_at desc) where price is not null;
create index if not exists price_log_sweep_idx
  on public.price_log (sweep_id);
-- The admin page's default view: what is broken right now.
create index if not exists price_log_failures_idx
  on public.price_log (session_date desc, captured_at desc) where price is null;

-- ---------------------------------------------------------------------------
-- Access. Writes are service-role only (the logger, and admin routes that
-- record who made a hand-edit). Admins may read. Nobody else sees either table.
-- ---------------------------------------------------------------------------
alter table public.price_sweep enable row level security;
alter table public.price_log   enable row level security;

drop policy if exists price_sweep_admin_read on public.price_sweep;
create policy price_sweep_admin_read on public.price_sweep
  for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

drop policy if exists price_log_admin_read on public.price_log;
create policy price_log_admin_read on public.price_log
  for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

commit;
