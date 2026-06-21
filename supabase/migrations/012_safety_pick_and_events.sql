-- Safety pick queue + draft feed events + auto-pick audit

alter table public.drafts add column if not exists safety_pick_symbol text;

alter table public.draft_picks add column if not exists is_auto_pick boolean not null default false;
alter table public.draft_picks add column if not exists auto_pick_reason text
  check (auto_pick_reason is null or auto_pick_reason in ('safety_queue', 'highest_price', 'bot', 'timer'));
alter table public.draft_picks add column if not exists global_pick_number int;

create table if not exists public.league_draft_events (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  team_name text not null,
  round_number int not null check (round_number >= 1),
  symbol text not null,
  pick_type text not null check (pick_type in ('stock', 'bench', 'crypto', 'skip')),
  budget_spent numeric not null default 0,
  surcharge_percent numeric not null default 0,
  global_pick_number int not null check (global_pick_number >= 1),
  message text not null,
  is_auto_pick boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists league_draft_events_league_id_idx
  on public.league_draft_events (league_id, created_at desc);
create index if not exists league_draft_events_global_pick_idx
  on public.league_draft_events (league_id, global_pick_number);

alter table public.league_draft_events enable row level security;

drop policy if exists "League members can view draft events" on public.league_draft_events;
create policy "League members can view draft events"
  on public.league_draft_events for select
  to authenticated
  using (public.is_league_member(league_id));

drop policy if exists "AI league owner can insert draft events" on public.league_draft_events;
create policy "AI league owner can insert draft events"
  on public.league_draft_events for insert
  to authenticated
  with check (
    exists (
      select 1 from public.leagues l
      where l.id = league_draft_events.league_id
        and l.league_type = 'ai'
        and l.owner_user_id = auth.uid()
    )
  );

drop policy if exists "Users can update own draft safety pick" on public.drafts;
create policy "Users can update own draft safety pick"
  on public.drafts for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
