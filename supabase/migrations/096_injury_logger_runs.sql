-- Run history for the injury logger (src/lib/injuries/logger.ts) — the one
-- thing that polls RotoWire's injury-report feed and writes real observed
-- status changes into sim_player_injuries. Mirrors price_sweep's shape
-- (089_price_log.sql): a "running" row is opened before the poll, and closed
-- out with counts and an error (if any) when it finishes.

begin;

create table if not exists public.injury_logger_runs (
  id                bigint generated always as identity primary key,

  sport             text not null default 'nfl',
  season            text not null,
  week_number       integer,

  status            text not null default 'running'
                      check (status in ('running', 'complete', 'failed')),

  started_at        timestamptz not null default now(),
  finished_at       timestamptz,

  entries_fetched   integer not null default 0,
  players_matched   integer not null default 0,
  injuries_opened   integer not null default 0,
  injuries_updated  integer not null default 0,
  injuries_closed   integer not null default 0,

  -- Unmatched RotoWire entries, ambiguous name matches, etc. — the
  -- admin page's problems-first view reads this.
  issues            jsonb not null default '[]'::jsonb,

  triggered_by      text not null check (triggered_by in ('cron', 'manual')),
  triggered_by_user uuid references public.profiles(id) on delete set null,
  error             text
);

create index if not exists injury_logger_runs_sport_season_idx
  on public.injury_logger_runs (sport, season, started_at desc);
create index if not exists injury_logger_runs_running_idx
  on public.injury_logger_runs (started_at desc) where status = 'running';

alter table public.injury_logger_runs enable row level security;

drop policy if exists injury_logger_runs_admin_read on public.injury_logger_runs;
create policy injury_logger_runs_admin_read on public.injury_logger_runs
  for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

commit;
