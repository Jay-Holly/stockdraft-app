-- Phase 4: Draft Room tables

create table if not exists public.drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'complete')),
  current_round int not null default 1 check (current_round >= 1),
  pushback_skips_remaining int not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id)
);

create table if not exists public.draft_picks (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.drafts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  round_number int not null check (round_number >= 1),
  pick_type text not null check (pick_type in ('stock', 'bench', 'crypto', 'skip')),
  symbol text not null,
  price_at_pick numeric not null default 0,
  budget_spent numeric not null default 0,
  shares numeric not null default 0,
  surcharge_percent numeric not null default 0,
  effective_value numeric not null default 0,
  pick_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.crypto_buyer_counts (
  symbol text primary key check (symbol in ('BTC', 'ETH', 'SOL', 'DOGE')),
  buyer_count int not null default 0 check (buyer_count >= 0)
);

insert into public.crypto_buyer_counts (symbol, buyer_count)
values ('BTC', 0), ('ETH', 0), ('SOL', 0), ('DOGE', 0)
on conflict (symbol) do nothing;

create index if not exists draft_picks_draft_id_idx on public.draft_picks (draft_id);
create index if not exists draft_picks_user_id_idx on public.draft_picks (user_id);
create index if not exists drafts_user_id_idx on public.drafts (user_id);

alter table public.drafts enable row level security;
alter table public.draft_picks enable row level security;
alter table public.crypto_buyer_counts enable row level security;

drop policy if exists "Users can view own drafts" on public.drafts;
create policy "Users can view own drafts"
  on public.drafts for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own drafts" on public.drafts;
create policy "Users can insert own drafts"
  on public.drafts for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own drafts" on public.drafts;
create policy "Users can update own drafts"
  on public.drafts for update
  using (auth.uid() = user_id);

drop policy if exists "Users can view own draft picks" on public.draft_picks;
create policy "Users can view own draft picks"
  on public.draft_picks for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own draft picks" on public.draft_picks;
create policy "Users can insert own draft picks"
  on public.draft_picks for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own draft picks" on public.draft_picks;
create policy "Users can delete own draft picks"
  on public.draft_picks for delete
  using (auth.uid() = user_id);

drop policy if exists "Authenticated users can read crypto buyer counts" on public.crypto_buyer_counts;
create policy "Authenticated users can read crypto buyer counts"
  on public.crypto_buyer_counts for select
  to authenticated
  using (true);

drop policy if exists "Authenticated users can update crypto buyer counts" on public.crypto_buyer_counts;
create policy "Authenticated users can update crypto buyer counts"
  on public.crypto_buyer_counts for update
  to authenticated
  using (true);
