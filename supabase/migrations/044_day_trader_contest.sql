-- Day Trader weekly contest: global contest, entries, positions, trades, admin flag.

alter table public.profiles
  add column if not exists is_admin boolean not null default false;

create table if not exists public.day_trader_contests (
  id uuid primary key default gen_random_uuid(),
  week_start_at timestamptz not null,
  week_end_at timestamptz not null,
  status text not null default 'upcoming'
    check (status in ('upcoming', 'open', 'closed', 'finalized')),
  contest_name text not null default 'Day Trader',
  dollar_prize_text text not null default '',
  percent_prize_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint day_trader_contests_week_bounds check (week_end_at > week_start_at)
);

create unique index if not exists day_trader_contests_week_start_uidx
  on public.day_trader_contests (week_start_at);

create index if not exists day_trader_contests_status_idx
  on public.day_trader_contests (status);

create table if not exists public.day_trader_entries (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.day_trader_contests(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  source_league_id uuid references public.leagues(id) on delete set null,
  source_league_name text,
  entered_at timestamptz not null default now(),
  starting_value numeric not null default 500000
    check (starting_value > 0),
  cash_balance numeric not null default 0
    check (cash_balance >= 0),
  final_value numeric,
  final_dollar_gain numeric,
  final_pct_gain numeric,
  unique (contest_id, user_id)
);

create index if not exists day_trader_entries_contest_idx
  on public.day_trader_entries (contest_id);

create index if not exists day_trader_entries_user_idx
  on public.day_trader_entries (user_id);

create table if not exists public.day_trader_positions (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.day_trader_entries(id) on delete cascade,
  symbol text not null,
  shares numeric not null check (shares > 0),
  slot_order int not null default 0,
  source_pick_id uuid references public.draft_picks(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (entry_id, symbol)
);

create index if not exists day_trader_positions_entry_idx
  on public.day_trader_positions (entry_id);

create table if not exists public.day_trader_trades (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.day_trader_entries(id) on delete cascade,
  symbol text not null,
  side text not null check (side in ('buy', 'sell')),
  shares numeric not null check (shares > 0),
  price numeric not null check (price > 0),
  notional numeric not null check (notional > 0),
  traded_at timestamptz not null default now()
);

create index if not exists day_trader_trades_entry_idx
  on public.day_trader_trades (entry_id, traded_at desc);

-- Admin helper for RLS (step 5 form; cron uses service role).
create or replace function public.is_admin_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select is_admin from public.profiles where id = auth.uid()),
    false
  );
$$;

alter table public.day_trader_contests enable row level security;
alter table public.day_trader_entries enable row level security;
alter table public.day_trader_positions enable row level security;
alter table public.day_trader_trades enable row level security;

drop policy if exists "Authenticated read day trader contests" on public.day_trader_contests;
create policy "Authenticated read day trader contests"
  on public.day_trader_contests for select
  to authenticated
  using (true);

drop policy if exists "Admins manage day trader contests" on public.day_trader_contests;
create policy "Admins manage day trader contests"
  on public.day_trader_contests for all
  to authenticated
  using (public.is_admin_user())
  with check (public.is_admin_user());

drop policy if exists "Authenticated read day trader entries" on public.day_trader_entries;
create policy "Authenticated read day trader entries"
  on public.day_trader_entries for select
  to authenticated
  using (true);

drop policy if exists "Users insert own day trader entries" on public.day_trader_entries;
create policy "Users insert own day trader entries"
  on public.day_trader_entries for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users update own day trader entries" on public.day_trader_entries;
create policy "Users update own day trader entries"
  on public.day_trader_entries for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Entry owners read positions" on public.day_trader_positions;
create policy "Entry owners read positions"
  on public.day_trader_positions for select
  to authenticated
  using (
    exists (
      select 1 from public.day_trader_entries e
      where e.id = entry_id and e.user_id = auth.uid()
    )
  );

drop policy if exists "Authenticated read positions for leaderboard" on public.day_trader_positions;
create policy "Authenticated read positions for leaderboard"
  on public.day_trader_positions for select
  to authenticated
  using (true);

drop policy if exists "Entry owners manage positions" on public.day_trader_positions;
create policy "Entry owners manage positions"
  on public.day_trader_positions for all
  to authenticated
  using (
    exists (
      select 1 from public.day_trader_entries e
      where e.id = entry_id and e.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.day_trader_entries e
      where e.id = entry_id and e.user_id = auth.uid()
    )
  );

drop policy if exists "Entry owners read trades" on public.day_trader_trades;
create policy "Entry owners read trades"
  on public.day_trader_trades for select
  to authenticated
  using (
    exists (
      select 1 from public.day_trader_entries e
      where e.id = entry_id and e.user_id = auth.uid()
    )
  );

drop policy if exists "Entry owners insert trades" on public.day_trader_trades;
create policy "Entry owners insert trades"
  on public.day_trader_trades for insert
  to authenticated
  with check (
    exists (
      select 1 from public.day_trader_entries e
      where e.id = entry_id and e.user_id = auth.uid()
    )
  );
