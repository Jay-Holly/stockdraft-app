-- Phase 1: schema foundation for Stripe Identity (age/location verification)
-- and Stripe Connect (automated payouts). No app logic depends on these yet.

alter table public.profiles
  add column if not exists date_of_birth date,
  add column if not exists state text,
  add column if not exists identity_status text not null default 'unverified',
  add column if not exists identity_session_id text,
  add column if not exists stripe_connect_account_id text,
  add column if not exists connect_status text not null default 'none';

alter table public.profiles
  add constraint profiles_identity_status_check
    check (identity_status in ('unverified', 'pending', 'verified', 'failed'));

alter table public.profiles
  add constraint profiles_connect_status_check
    check (connect_status in ('none', 'onboarding', 'active', 'restricted'));
