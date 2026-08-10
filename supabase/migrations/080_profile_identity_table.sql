-- Move sensitive identity/payout fields off `profiles` (which has a
-- "viewable by everyone" select policy for public leaderboard display)
-- into a dedicated owner-only table.

create table public.profile_identity (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  date_of_birth date,
  state text,
  identity_status text not null default 'unverified'
    check (identity_status in ('unverified', 'pending', 'verified', 'failed')),
  identity_session_id text,
  stripe_connect_account_id text,
  connect_status text not null default 'none'
    check (connect_status in ('none', 'onboarding', 'active', 'restricted')),
  updated_at timestamptz not null default now()
);

alter table public.profile_identity enable row level security;

create policy "Users can view their own identity record"
  on public.profile_identity for select
  using (auth.uid() = user_id);

create policy "Service role manages identity records"
  on public.profile_identity for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

insert into public.profile_identity (user_id, date_of_birth, state, identity_status, identity_session_id, stripe_connect_account_id, connect_status)
select id, date_of_birth, state, identity_status, identity_session_id, stripe_connect_account_id, connect_status
from public.profiles;

alter table public.profiles
  drop constraint if exists profiles_identity_status_check,
  drop constraint if exists profiles_connect_status_check,
  drop column if exists date_of_birth,
  drop column if exists state,
  drop column if exists identity_status,
  drop column if exists identity_session_id,
  drop column if exists stripe_connect_account_id,
  drop column if exists connect_status;
