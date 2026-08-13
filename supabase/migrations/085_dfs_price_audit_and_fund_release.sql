-- Two-round price audit for the DFS contests, and the fund-release gate that
-- depends on it.
--
-- Scoring a contest and paying it out are now separate events. The 4 PM
-- lifecycle run scores a contest (ranks, payouts, standings all visible) but
-- credits nobody. Money only moves after both audit rounds pass:
--
--   Round 1 (completeness) — every pick in every scored contest has a real
--     open and close. Anything missing is backfilled from the independent
--     source's historical 1-minute bars, which still hold that day's true
--     09:30 open hours after the fact.
--   Round 2 (verification) — every stored open/close is re-read from the
--     independent source and compared. A divergence past tolerance fails the
--     round rather than paying out on a number two sources disagree about.
--
-- All three tables are service-role only: RLS on, no policies granted.

create table if not exists public.dfs_price_audits (
  id bigserial primary key,
  audit_date date not null,
  symbol text not null,

  -- What the live lock/score path stored.
  stored_open numeric,
  stored_close numeric,

  -- What the independent source reports for the same session.
  verified_open numeric,
  verified_close numeric,
  open_diff_pct numeric,
  close_diff_pct numeric,

  -- ok           — both sources agree inside tolerance
  -- backfilled   — was missing, recovered from the independent source
  -- divergent    — sources disagree past tolerance (blocks payout)
  -- missing      — no value from either source (blocks payout)
  -- unverifiable — stored value exists, independent source had nothing to
  --                compare it against (single-sourced, reported not trusted)
  open_status text
    check (open_status in ('ok','backfilled','divergent','missing','unverifiable')),
  close_status text
    check (close_status in ('ok','backfilled','divergent','missing','unverifiable')),

  checked_at timestamptz not null default now(),
  unique (audit_date, symbol)
);

create index if not exists dfs_price_audits_date_idx
  on public.dfs_price_audits (audit_date);

create table if not exists public.dfs_audit_runs (
  id bigserial primary key,
  audit_date date not null,
  round int not null check (round in (1, 2)),
  status text not null default 'running'
    check (status in ('running', 'passed', 'failed')),

  symbols_total int not null default 0,
  symbols_checked int not null default 0,
  issues jsonb not null default '[]'::jsonb,

  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (audit_date, round)
);

create index if not exists dfs_audit_runs_date_idx
  on public.dfs_audit_runs (audit_date);

-- One row per contest that has actually paid out. The unique constraint is
-- the double-pay guard: the release job inserts here BEFORE crediting any
-- wallet, so a re-run (retry, overlapping cron, manual trigger) collides and
-- aborts instead of paying a second time.
create table if not exists public.contest_fund_releases (
  id bigserial primary key,
  contest_type text not null check (contest_type in ('sddfs', 'sdwfs')),
  contest_id uuid not null,
  audit_date date not null,
  entries_paid int not null default 0,
  total_released numeric not null default 0,
  released_at timestamptz not null default now(),
  unique (contest_type, contest_id)
);

create index if not exists contest_fund_releases_date_idx
  on public.contest_fund_releases (audit_date);

alter table public.dfs_price_audits enable row level security;
alter table public.dfs_audit_runs enable row level security;
alter table public.contest_fund_releases enable row level security;
