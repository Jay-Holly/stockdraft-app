-- Season roster management: IR swaps, crypto swaps, waiver pickups

alter table public.draft_picks add column if not exists acquired_via text not null default 'draft'
  check (acquired_via in ('draft', 'waiver'));

alter table public.draft_picks add column if not exists updated_at timestamptz not null default now();

create table if not exists public.roster_moves (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  move_type text not null check (
    move_type in ('ir_swap', 'crypto_swap', 'waiver_add')
  ),
  pick_id uuid references public.draft_picks(id) on delete set null,
  related_pick_id uuid references public.draft_picks(id) on delete set null,
  symbol text not null,
  prior_symbol text,
  prior_pick_type text,
  new_pick_type text,
  budget_before numeric,
  budget_after numeric,
  price_at_move numeric,
  shares_after numeric,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists roster_moves_league_user_idx
  on public.roster_moves (league_id, user_id, created_at desc);

alter table public.roster_moves enable row level security;

drop policy if exists "League members view roster moves" on public.roster_moves;
create policy "League members view roster moves"
  on public.roster_moves for select
  to authenticated
  using (public.is_league_member(league_id));

drop policy if exists "Users insert own roster moves" on public.roster_moves;
create policy "Users insert own roster moves"
  on public.roster_moves for insert
  to authenticated
  with check (auth.uid() = user_id and public.is_league_member(league_id));

-- draft_picks: allow owners to update their picks during the season
drop policy if exists "Users can update own draft picks" on public.draft_picks;
create policy "Users can update own draft picks"
  on public.draft_picks for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- draft_picks: allow inserting waiver pickups on own draft
-- (insert policy from 002/007 already covers auth.uid() = user_id)
