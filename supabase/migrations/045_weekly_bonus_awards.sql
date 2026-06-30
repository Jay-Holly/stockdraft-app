-- Weekly Bonus Awards: pool ledger, weekly results, and crypto claim payouts

create table if not exists public.league_bonus_pools (
  league_id uuid primary key references public.leagues(id) on delete cascade,
  season_base_total numeric not null default 100000,
  regular_season_weeks int not null default 11,
  weekly_base_amount numeric not null default 9091,
  draft_surcharge_total numeric not null default 0,
  rollover_balance numeric not null default 0,
  playoff_pool_balance numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.weekly_award_results (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  week_number int not null check (week_number >= 1),
  award_key text not null check (
    award_key in (
      'winner_of_week',
      'rookie_of_week',
      'diamond_hands',
      'lottery_hit',
      'sweep_week',
      'loser_of_week',
      'bench_curse'
    )
  ),
  amount_usd numeric not null,
  winner_user_id uuid references public.profiles(id) on delete set null,
  qualifying_pick_id uuid references public.draft_picks(id) on delete set null,
  qualifying_symbol text,
  detail_json jsonb not null default '{}'::jsonb,
  no_winner_reason text,
  computed_at timestamptz not null default now(),
  unique (league_id, week_number, award_key)
);

create index if not exists weekly_award_results_league_week_idx
  on public.weekly_award_results (league_id, week_number desc);

create table if not exists public.weekly_award_payouts (
  id uuid primary key default gen_random_uuid(),
  award_result_id uuid not null references public.weekly_award_results(id) on delete cascade,
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount_usd numeric not null,
  status text not null default 'pending' check (
    status in ('pending', 'claimed', 'auto_claimed', 'forfeited')
  ),
  target_pick_id uuid references public.draft_picks(id) on delete set null,
  target_symbol text,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (award_result_id)
);

create index if not exists weekly_award_payouts_user_pending_idx
  on public.weekly_award_payouts (user_id, status)
  where status = 'pending';

alter table public.league_bonus_pools enable row level security;
alter table public.weekly_award_results enable row level security;
alter table public.weekly_award_payouts enable row level security;

-- League members can read pool + results for their league
drop policy if exists "League members view bonus pool" on public.league_bonus_pools;
create policy "League members view bonus pool"
  on public.league_bonus_pools for select
  to authenticated
  using (
    exists (
      select 1 from public.league_members lm
      where lm.league_id = league_bonus_pools.league_id
        and lm.user_id = auth.uid()
    )
    or exists (
      select 1 from public.leagues l
      where l.id = league_bonus_pools.league_id
        and l.owner_user_id = auth.uid()
    )
  );

drop policy if exists "League members view weekly awards" on public.weekly_award_results;
create policy "League members view weekly awards"
  on public.weekly_award_results for select
  to authenticated
  using (
    exists (
      select 1 from public.league_members lm
      where lm.league_id = weekly_award_results.league_id
        and lm.user_id = auth.uid()
    )
    or exists (
      select 1 from public.leagues l
      where l.id = weekly_award_results.league_id
        and l.owner_user_id = auth.uid()
    )
  );

drop policy if exists "Users view own award payouts" on public.weekly_award_payouts;
create policy "Users view own award payouts"
  on public.weekly_award_payouts for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users update own pending payouts" on public.weekly_award_payouts;
create policy "Users update own pending payouts"
  on public.weekly_award_payouts for update
  to authenticated
  using (auth.uid() = user_id and status = 'pending')
  with check (auth.uid() = user_id);
