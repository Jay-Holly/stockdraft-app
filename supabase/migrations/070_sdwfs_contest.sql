-- SDWFS: weekly-cycle sibling of SDDFS. One entry per user per contest, 12
-- picks (one per sector), scored on Monday-open to Friday-close cumulative
-- % change, top 3 paid with ties split evenly. One contest per buy-in tier
-- per week (not per day).

create table if not exists public.sdwfs_contests (
  id uuid primary key default gen_random_uuid(),
  week_start_date date not null,
  buy_in numeric not null check (buy_in > 0),
  max_entrants int not null default 10 check (max_entrants > 0),
  lock_at timestamptz not null,
  score_at timestamptz not null,
  status text not null default 'open'
    check (status in ('open', 'locked', 'scored')),
  created_at timestamptz not null default now(),
  unique (week_start_date, buy_in)
);

create index if not exists sdwfs_contests_status_idx
  on public.sdwfs_contests (status);

create table if not exists public.sdwfs_entries (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.sdwfs_contests(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  entered_at timestamptz not null default now(),
  total_score numeric,
  final_rank int,
  payout numeric,
  unique (contest_id, user_id)
);

create index if not exists sdwfs_entries_contest_idx
  on public.sdwfs_entries (contest_id);

create index if not exists sdwfs_entries_user_idx
  on public.sdwfs_entries (user_id);

-- One pick per sector per entry; symbols are NOT exclusive across entries.
create table if not exists public.sdwfs_entry_picks (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.sdwfs_entries(id) on delete cascade,
  sector text not null,
  symbol text not null,
  open_price numeric,
  close_price numeric,
  pct_change numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entry_id, sector)
);

create index if not exists sdwfs_entry_picks_entry_idx
  on public.sdwfs_entry_picks (entry_id);

alter table public.sdwfs_contests enable row level security;
alter table public.sdwfs_entries enable row level security;
alter table public.sdwfs_entry_picks enable row level security;

drop policy if exists "Authenticated read sdwfs contests" on public.sdwfs_contests;
create policy "Authenticated read sdwfs contests"
  on public.sdwfs_contests for select
  to authenticated
  using (true);

drop policy if exists "Admins manage sdwfs contests" on public.sdwfs_contests;
create policy "Admins manage sdwfs contests"
  on public.sdwfs_contests for all
  to authenticated
  using (public.is_admin_user())
  with check (public.is_admin_user());

drop policy if exists "Authenticated read sdwfs entries" on public.sdwfs_entries;
create policy "Authenticated read sdwfs entries"
  on public.sdwfs_entries for select
  to authenticated
  using (true);

drop policy if exists "Users insert own sdwfs entries" on public.sdwfs_entries;
create policy "Users insert own sdwfs entries"
  on public.sdwfs_entries for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users update own sdwfs entries before lock" on public.sdwfs_entries;
create policy "Users update own sdwfs entries before lock"
  on public.sdwfs_entries for update
  to authenticated
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.sdwfs_contests c
      where c.id = contest_id and c.status = 'open'
    )
  )
  with check (auth.uid() = user_id);

drop policy if exists "Admins manage sdwfs entries" on public.sdwfs_entries;
create policy "Admins manage sdwfs entries"
  on public.sdwfs_entries for all
  to authenticated
  using (public.is_admin_user())
  with check (public.is_admin_user());

drop policy if exists "Authenticated read sdwfs picks" on public.sdwfs_entry_picks;
create policy "Authenticated read sdwfs picks"
  on public.sdwfs_entry_picks for select
  to authenticated
  using (true);

drop policy if exists "Entry owners manage picks before lock" on public.sdwfs_entry_picks;
create policy "Entry owners manage picks before lock"
  on public.sdwfs_entry_picks for all
  to authenticated
  using (
    exists (
      select 1 from public.sdwfs_entries e
      join public.sdwfs_contests c on c.id = e.contest_id
      where e.id = entry_id and e.user_id = auth.uid() and c.status = 'open'
    )
  )
  with check (
    exists (
      select 1 from public.sdwfs_entries e
      join public.sdwfs_contests c on c.id = e.contest_id
      where e.id = entry_id and e.user_id = auth.uid() and c.status = 'open'
    )
  );

drop policy if exists "Admins manage sdwfs picks" on public.sdwfs_entry_picks;
create policy "Admins manage sdwfs picks"
  on public.sdwfs_entry_picks for all
  to authenticated
  using (public.is_admin_user())
  with check (public.is_admin_user());
