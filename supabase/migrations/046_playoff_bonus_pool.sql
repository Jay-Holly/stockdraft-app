-- Playoff bonus pool: seed tracking, allocations, payouts, and ledger

alter table public.league_bonus_pools
  add column if not exists playoff_pool_seed_amount numeric not null default 5000,
  add column if not exists regular_season_pool_total numeric not null default 95000,
  add column if not exists playoff_allocation_status text not null default 'accumulating'
    check (playoff_allocation_status in ('accumulating', 'allocated', 'paid_out')),
  add column if not exists playoff_allocated_at timestamptz,
  add column if not exists playoff_allocation_week int;

-- Retroactive seed + weekly base adjustment for existing pools
update public.league_bonus_pools
set
  regular_season_pool_total = season_base_total - 5000,
  weekly_base_amount = (season_base_total - 5000)::numeric / regular_season_weeks,
  playoff_pool_balance = playoff_pool_balance + 5000
where playoff_allocation_status = 'accumulating';

create table if not exists public.playoff_bonus_allocations (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  allocation_week int not null,
  total_pool_amount numeric not null,
  seed_amount numeric not null,
  rollover_amount numeric not null,
  status text not null default 'pending_claims'
    check (status in ('pending_claims', 'complete')),
  created_at timestamptz not null default now(),
  unique (league_id, allocation_week)
);

create table if not exists public.playoff_bonus_payouts (
  id uuid primary key default gen_random_uuid(),
  allocation_id uuid not null references public.playoff_bonus_allocations(id) on delete cascade,
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  seed_rank int not null check (seed_rank between 1 and 4),
  share_pct numeric not null,
  amount_usd numeric not null,
  status text not null default 'pending'
    check (status in ('pending', 'claimed', 'auto_claimed')),
  target_pick_id uuid references public.draft_picks(id) on delete set null,
  target_symbol text,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (allocation_id, user_id),
  unique (allocation_id, seed_rank)
);

create index if not exists playoff_bonus_payouts_user_pending_idx
  on public.playoff_bonus_payouts (user_id, status)
  where status = 'pending';

create table if not exists public.playoff_pool_ledger (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  week_number int,
  event_type text not null
    check (event_type in ('seed', 'weekly_rollover', 'allocation', 'payout')),
  amount_usd numeric not null,
  balance_after numeric not null,
  detail_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists playoff_pool_ledger_league_idx
  on public.playoff_pool_ledger (league_id, created_at asc);

-- Seed ledger rows for pools that received retroactive credit
insert into public.playoff_pool_ledger (league_id, week_number, event_type, amount_usd, balance_after, detail_json)
select
  lbp.league_id,
  null,
  'seed',
  5000,
  lbp.playoff_pool_balance,
  jsonb_build_object('retroactive', true)
from public.league_bonus_pools lbp
where not exists (
  select 1 from public.playoff_pool_ledger pl
  where pl.league_id = lbp.league_id and pl.event_type = 'seed'
);

alter table public.playoff_bonus_allocations enable row level security;
alter table public.playoff_bonus_payouts enable row level security;
alter table public.playoff_pool_ledger enable row level security;

drop policy if exists "League members view playoff allocations" on public.playoff_bonus_allocations;
create policy "League members view playoff allocations"
  on public.playoff_bonus_allocations for select
  to authenticated
  using (
    exists (
      select 1 from public.league_members lm
      where lm.league_id = playoff_bonus_allocations.league_id
        and lm.user_id = auth.uid()
    )
    or exists (
      select 1 from public.leagues l
      where l.id = playoff_bonus_allocations.league_id
        and l.owner_user_id = auth.uid()
    )
  );

drop policy if exists "League members view playoff pool ledger" on public.playoff_pool_ledger;
create policy "League members view playoff pool ledger"
  on public.playoff_pool_ledger for select
  to authenticated
  using (
    exists (
      select 1 from public.league_members lm
      where lm.league_id = playoff_pool_ledger.league_id
        and lm.user_id = auth.uid()
    )
    or exists (
      select 1 from public.leagues l
      where l.id = playoff_pool_ledger.league_id
        and l.owner_user_id = auth.uid()
    )
  );

drop policy if exists "Users view own playoff payouts" on public.playoff_bonus_payouts;
create policy "Users view own playoff payouts"
  on public.playoff_bonus_payouts for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users update own pending playoff payouts" on public.playoff_bonus_payouts;
create policy "Users update own pending playoff payouts"
  on public.playoff_bonus_payouts for update
  to authenticated
  using (auth.uid() = user_id and status = 'pending')
  with check (auth.uid() = user_id);
