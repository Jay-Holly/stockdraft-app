-- Phase 4b: Leagues + league-scoped draft availability

create table if not exists public.leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_solo boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.league_members (
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (league_id, user_id)
);

alter table public.drafts
  add column if not exists league_id uuid references public.leagues(id) on delete cascade;

alter table public.drafts drop constraint if exists drafts_user_id_key;

create unique index if not exists drafts_league_user_idx
  on public.drafts (league_id, user_id)
  where league_id is not null;

create index if not exists drafts_league_id_idx on public.drafts (league_id);
create index if not exists league_members_user_id_idx on public.league_members (user_id);

-- League-scoped crypto surcharge counts (replaces global-only table)
create table if not exists public.league_crypto_buyer_counts (
  league_id uuid not null references public.leagues(id) on delete cascade,
  symbol text not null,
  buyer_count int not null default 0 check (buyer_count >= 0),
  primary key (league_id, symbol)
);

alter table public.leagues enable row level security;
alter table public.league_members enable row level security;
alter table public.league_crypto_buyer_counts enable row level security;

-- Membership helper (SECURITY DEFINER bypasses RLS — avoids leagues ↔ league_members recursion)
create or replace function public.is_league_member(p_league_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.league_members
    where league_id = p_league_id
      and user_id = auth.uid()
  );
$$;

grant execute on function public.is_league_member(uuid) to authenticated;

drop policy if exists "Members can view their leagues" on public.leagues;
create policy "Members can view their leagues"
  on public.leagues for select
  using (
    public.is_league_member(id)
    or (
      is_solo = true
      and not exists (
        select 1 from public.league_members lm where lm.league_id = leagues.id
      )
    )
  );

drop policy if exists "Users can create solo leagues" on public.leagues;
create policy "Users can create solo leagues"
  on public.leagues for insert
  with check (true);

drop policy if exists "Members can view league membership" on public.league_members;
create policy "Members can view league membership"
  on public.league_members for select
  using (user_id = auth.uid());

drop policy if exists "Users can join leagues as themselves" on public.league_members;
create policy "Users can join leagues as themselves"
  on public.league_members for insert
  with check (auth.uid() = user_id);

drop policy if exists "League members can read crypto buyer counts" on public.league_crypto_buyer_counts;
create policy "League members can read crypto buyer counts"
  on public.league_crypto_buyer_counts for select
  using (public.is_league_member(league_id));

drop policy if exists "League members can update crypto buyer counts" on public.league_crypto_buyer_counts;
create policy "League members can update crypto buyer counts"
  on public.league_crypto_buyer_counts for update
  using (public.is_league_member(league_id));

drop policy if exists "League members can insert crypto buyer counts" on public.league_crypto_buyer_counts;
create policy "League members can insert crypto buyer counts"
  on public.league_crypto_buyer_counts for insert
  with check (public.is_league_member(league_id));

-- Allow league members to read draft picks within their league (for off-board tracking)
drop policy if exists "League members can view league draft picks" on public.draft_picks;
create policy "League members can view league draft picks"
  on public.draft_picks for select
  using (
    auth.uid() = user_id
    or exists (
      select 1
      from public.drafts d
      where d.id = draft_picks.draft_id
        and public.is_league_member(d.league_id)
    )
  );

-- Platform-wide rostered symbols (any authenticated user can read for WS subscription list)
create or replace function public.get_platform_rostered_stock_symbols()
returns table (symbol text)
language sql
security definer
set search_path = public
stable
as $$
  select distinct upper(dp.symbol) as symbol
  from public.draft_picks dp
  where dp.pick_type in ('stock', 'bench')
    and dp.symbol is not null
    and dp.symbol <> 'SKIP';
$$;

grant execute on function public.get_platform_rostered_stock_symbols() to authenticated;

-- League off-board symbols for a league
create or replace function public.get_league_drafted_stock_symbols(p_league_id uuid)
returns table (symbol text)
language sql
security definer
set search_path = public
stable
as $$
  select distinct upper(dp.symbol) as symbol
  from public.draft_picks dp
  join public.drafts d on d.id = dp.draft_id
  where d.league_id = p_league_id
    and dp.pick_type in ('stock', 'bench')
    and dp.symbol is not null
    and dp.symbol <> 'SKIP';
$$;

grant execute on function public.get_league_drafted_stock_symbols(uuid) to authenticated;
