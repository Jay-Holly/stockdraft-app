-- 090_ranking_snapshots.sql
--
-- Frozen rankings.
--
-- Two lists are ranked 1..N and paired by rank: S&P stocks by market cap, and
-- pro players by whatever method the operator states. Stock #47 is player #47,
-- which is what lets a real player's injury put a stock on IR.
--
-- The rule that matters: once a season drafts against a snapshot, that snapshot
-- never changes again. Re-rank freely for next season -- leagues already
-- running keep the list they drafted under. Without this, a mid-season re-rank
-- silently changes which player your stock is, and every injury lands on the
-- wrong roster.
--
-- Rankings live here rather than in a code file so they are visible on the
-- admin page, editable without a deploy, and rebuildable each season.

begin;

create table if not exists public.ranking_snapshot (
  id          bigint generated always as identity primary key,

  kind        text not null check (kind in ('stock', 'player')),
  -- null for stock rankings; the sport for player rankings.
  sport       text check (
                (kind = 'stock'  and sport is null) or
                (kind = 'player' and sport in ('nfl', 'mlb', 'nhl', 'nba'))
              ),
  season_year integer not null,

  label       text not null,
  -- Stateable method, e.g. 'market cap via finnhub 2026-08-28' or
  -- 'top 100 consensus, 101-503 by 2025 snap counts'. Required: a ranking
  -- nobody can explain is the one that gets argued with.
  method      text not null,

  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id) on delete set null,
  -- Set when the first league drafts against it. After this, immutable.
  frozen_at   timestamptz
);

create unique index if not exists ranking_snapshot_current_idx
  on public.ranking_snapshot (kind, coalesce(sport, ''), season_year, label);

create table if not exists public.ranking_entry (
  id           bigint generated always as identity primary key,
  snapshot_id  bigint not null references public.ranking_snapshot(id) on delete cascade,

  rank         integer not null check (rank > 0),

  -- Exactly one side is populated, matching the snapshot's kind.
  symbol       text,
  market_cap   numeric(24, 2) check (market_cap is null or market_cap > 0),
  player_name  text,
  player_team  text,

  note         text,

  unique (snapshot_id, rank)
);

create index if not exists ranking_entry_symbol_idx
  on public.ranking_entry (symbol) where symbol is not null;

-- A snapshot's rows must match its kind: stock rows carry a symbol, player rows
-- carry a name. Checked here because the constraint spans both tables.
create or replace function public.ranking_entry_matches_kind()
returns trigger language plpgsql as $$
declare snap_kind text;
begin
  select kind into snap_kind from public.ranking_snapshot where id = new.snapshot_id;
  if snap_kind = 'stock' and (new.symbol is null or new.player_name is not null) then
    raise exception 'stock ranking entries need a symbol and no player_name';
  end if;
  if snap_kind = 'player' and (new.player_name is null or new.symbol is not null) then
    raise exception 'player ranking entries need a player_name and no symbol';
  end if;
  return new;
end $$;

drop trigger if exists ranking_entry_kind_check on public.ranking_entry;
create trigger ranking_entry_kind_check
  before insert or update on public.ranking_entry
  for each row execute function public.ranking_entry_matches_kind();

-- Once frozen, the list is evidence. Nothing edits it -- not the app, not an
-- admin, not a migration that forgets. Make a new snapshot instead.
create or replace function public.ranking_entry_frozen_guard()
returns trigger language plpgsql as $$
declare frozen timestamptz;
begin
  select frozen_at into frozen from public.ranking_snapshot
   where id = coalesce(new.snapshot_id, old.snapshot_id);
  if frozen is not null then
    raise exception 'ranking snapshot % is frozen (since %); create a new snapshot instead',
      coalesce(new.snapshot_id, old.snapshot_id), frozen;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists ranking_entry_frozen on public.ranking_entry;
create trigger ranking_entry_frozen
  before insert or update or delete on public.ranking_entry
  for each row execute function public.ranking_entry_frozen_guard();

alter table public.ranking_snapshot enable row level security;
alter table public.ranking_entry    enable row level security;

drop policy if exists ranking_snapshot_admin_read on public.ranking_snapshot;
create policy ranking_snapshot_admin_read on public.ranking_snapshot
  for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

drop policy if exists ranking_entry_admin_read on public.ranking_entry;
create policy ranking_entry_admin_read on public.ranking_entry
  for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

commit;
