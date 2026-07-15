-- Store email on profiles (previously only in auth.users, not usable by
-- app features) and add a support_requests table backing the Contact Us
-- form: email + league support code are the two things needed to find a
-- user's account and league when triaging a problem.

alter table public.profiles add column if not exists email text;

update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id
  and p.email is distinct from u.email;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (
    id,
    username,
    team_name,
    avatar_color,
    email,
    day_trader_joined_at
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'username', 'player_' || substr(new.id::text, 1, 8)),
    coalesce(new.raw_user_meta_data ->> 'team_name', 'My Team'),
    coalesce(new.raw_user_meta_data ->> 'avatar_color', 'blue'),
    new.email,
    case
      when coalesce(new.raw_user_meta_data ->> 'day_trader_signup', 'false') = 'true'
        then now()
      else null
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Keep profiles.email in sync if a user ever changes their auth email.
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.handle_user_email_change();

create table if not exists public.support_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  email text not null,
  support_code text,
  message text not null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now()
);

create index if not exists support_requests_status_idx
  on public.support_requests (status, created_at desc);

alter table public.support_requests enable row level security;

drop policy if exists "Users can insert own support requests" on public.support_requests;
create policy "Users can insert own support requests"
  on public.support_requests for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can view own support requests" on public.support_requests;
create policy "Users can view own support requests"
  on public.support_requests for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Admins can view all support requests" on public.support_requests;
create policy "Admins can view all support requests"
  on public.support_requests for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and is_admin = true
    )
  );

drop policy if exists "Admins can update support requests" on public.support_requests;
create policy "Admins can update support requests"
  on public.support_requests for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and is_admin = true
    )
  );
