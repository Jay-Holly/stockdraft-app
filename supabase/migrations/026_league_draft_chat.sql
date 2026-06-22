-- Live draft room chat (human messages + bot flavor reactions)

create table if not exists public.league_draft_chat_messages (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  author_name text not null,
  body text not null check (char_length(body) between 1 and 500),
  message_type text not null check (message_type in ('human', 'bot_reaction')),
  reaction_key text,
  draft_event_id uuid references public.league_draft_events(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists league_draft_chat_league_created_idx
  on public.league_draft_chat_messages (league_id, created_at asc);

create unique index if not exists league_draft_chat_reaction_key_idx
  on public.league_draft_chat_messages (league_id, reaction_key)
  where reaction_key is not null;

alter table public.league_draft_chat_messages enable row level security;

drop policy if exists "Members can view draft chat" on public.league_draft_chat_messages;
create policy "Members can view draft chat"
  on public.league_draft_chat_messages for select
  to authenticated
  using (
    public.is_league_member(league_id)
    or public.is_ai_league_owner(league_id)
  );

drop policy if exists "Members can post human draft chat" on public.league_draft_chat_messages;
create policy "Members can post human draft chat"
  on public.league_draft_chat_messages for insert
  to authenticated
  with check (
    message_type = 'human'
    and user_id = auth.uid()
    and (
      public.is_league_member(league_id)
      or public.is_ai_league_owner(league_id)
    )
  );

drop policy if exists "AI league owner can insert bot chat" on public.league_draft_chat_messages;
create policy "AI league owner can insert bot chat"
  on public.league_draft_chat_messages for insert
  to authenticated
  with check (
    message_type = 'bot_reaction'
    and public.is_ai_league_owner(league_id)
  );

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'league_draft_chat_messages'
  ) then
    alter publication supabase_realtime add table public.league_draft_chat_messages;
  end if;
end $$;
