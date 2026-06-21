-- Week-open roster values for weekly dollar gain and Winner of the Week tracking

create table if not exists public.roster_week_baselines (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  week_number int not null check (week_number >= 1),
  pick_id uuid not null references public.draft_picks(id) on delete cascade,
  value_at_open numeric not null default 0,
  captured_at timestamptz not null default now(),
  unique (league_id, user_id, week_number, pick_id)
);

create index if not exists roster_week_baselines_lookup_idx
  on public.roster_week_baselines (league_id, user_id, week_number);

alter table public.roster_week_baselines enable row level security;

drop policy if exists "Users view own week baselines" on public.roster_week_baselines;
create policy "Users view own week baselines"
  on public.roster_week_baselines for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users manage own week baselines" on public.roster_week_baselines;
create policy "Users manage own week baselines"
  on public.roster_week_baselines for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
