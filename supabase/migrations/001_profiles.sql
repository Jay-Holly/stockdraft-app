-- StockDraft: user profiles table
-- Run this in Supabase Dashboard → SQL Editor → New query → Run

create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  username text unique not null,
  team_name text not null default 'My Team',
  avatar_color text not null default 'blue',
  created_at timestamptz not null default now(),
  constraint username_length check (char_length(username) >= 3 and char_length(username) <= 24),
  constraint team_name_length check (char_length(team_name) >= 1 and char_length(team_name) <= 40),
  constraint avatar_color_valid check (avatar_color in ('blue', 'gold', 'green', 'red', 'purple', 'orange'))
);

alter table public.profiles enable row level security;

create policy "Profiles are viewable by everyone"
  on public.profiles for select
  using (true);

create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Auto-create profile row when a user signs up (optional fallback)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, username, team_name, avatar_color)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'username', 'player_' || substr(new.id::text, 1, 8)),
    coalesce(new.raw_user_meta_data ->> 'team_name', 'My Team'),
    coalesce(new.raw_user_meta_data ->> 'avatar_color', 'blue')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
