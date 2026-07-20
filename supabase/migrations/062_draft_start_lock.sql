-- Prevents overlapping start-scheduled-drafts cron ticks from racing on the
-- same league. A large-roster league (e.g. 32-team SDFL) can take longer
-- than the 2-minute cron interval to bot-fill + build its draft order, so
-- the next tick can start processing it before the first finishes — that
-- race produced a corrupted draft_order (a bot duplicated into two slots,
-- two real players silently dropped from the rotation).

alter table public.leagues
  add column if not exists draft_start_locked_at timestamptz;

-- Defense in depth: nothing previously stopped a duplicate member row for
-- the same (league, user) pair. No duplicates exist today (verified before
-- adding this), but the lock above prevents the race, not a schema-level
-- guarantee — this makes it one going forward.
create unique index if not exists league_members_league_user_unique
  on public.league_members (league_id, user_id);
