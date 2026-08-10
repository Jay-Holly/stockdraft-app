-- 083: stop exposing profiles.email to the public.
--
-- Migration 060 added `email` to public.profiles, a table that has had a
-- "Profiles are viewable by everyone" RLS policy since migration 001. RLS is
-- row-level only, so that policy covered the new column too: anyone holding
-- the anon key (which ships inside the browser bundle) could list every user's
-- email address, or look an account up by email.
--
-- RLS cannot hide a single column, so this uses column-level grants: the anon
-- and authenticated roles lose blanket SELECT on profiles and get it back for
-- every column EXCEPT `email`. Usernames, team names and avatar colors stay
-- publicly readable exactly as before, so nothing user-facing changes.
--
-- Consequences for app code:
--   * `.select("*")` on profiles — and a bare `.select()` after an insert —
--     now fails for logged-in users. Select explicit columns instead; use
--     PROFILE_COLUMNS from src/lib/profile/columns.ts.
--   * Server code that genuinely needs an email must go through the
--     service-role client, which these grants do not affect.
--   * If you ADD a column to profiles later, re-run this file so the new
--     column gets granted too. It is safe to re-run at any time.
--
-- Run in Supabase Dashboard -> SQL Editor -> New query -> Run.

revoke select on public.profiles from anon, authenticated, public;

do $$
declare
  col_list text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into col_list
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'profiles'
    and column_name <> 'email';

  execute format(
    'grant select (%s) on public.profiles to anon, authenticated',
    col_list
  );
end
$$;

-- Verification: both columns below must come back FALSE.
select
  has_column_privilege('anon', 'public.profiles', 'email', 'SELECT')
    as anon_can_read_email,
  has_column_privilege('authenticated', 'public.profiles', 'email', 'SELECT')
    as logged_in_user_can_read_email;
