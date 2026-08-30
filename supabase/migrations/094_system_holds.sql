-- 094_system_holds.sql
--
-- Every time this system refuses to act, written down where it can be seen.
--
-- The system already refuses correctly in several places: a contest that
-- cannot be priced does not lock, a roster with a missing price is not valued,
-- a payout is not released until two audit rounds pass. Each of those is the
-- right behaviour and each of them, until now, happened silently — visible
-- only in a server log nobody reads, or by querying a table directly.
--
-- From a player's side, "held pending verification" and "took my money and
-- vanished" look identical, because nobody told them which one it was. A
-- correct refusal that nobody hears about is indistinguishable from a fault,
-- and it is the version that gets screenshotted.
--
-- So a hold is a first-class record with a lifecycle: it opens, it persists
-- while the condition lasts, and it closes when the thing finally succeeds.
-- Re-recording an existing hold updates it rather than duplicating it, so a
-- condition repeating every minute stays one row with a count and a
-- last-seen time instead of ten thousand rows nobody can read.

begin;

create table if not exists public.system_holds (
  id bigint generated always as identity primary key,

  -- What kind of refusal this is.
  kind text not null check (kind in (
    'contest-lock',    -- a contest would not lock: missing opening prices
    'contest-settle',  -- a contest would not settle: missing closing prices
    'roster-value',    -- a roster could not be valued: missing prices
    'baseline',        -- a period baseline could not be established
    'fund-release',    -- payouts held: audit has not passed
    'audit-stalled',   -- an audit run died mid-flight
    'sweep-stalled'    -- a price sweep died mid-flight
  )),

  -- What is being held. Kept as text rather than a foreign key on purpose:
  -- holds outlive the rows they describe, and a hold that vanishes because
  -- its subject was deleted is exactly the disappearance this table prevents.
  subject_type text not null,
  subject_id   text not null,

  -- Plain language, written for a human reading it cold at 9 AM.
  reason text not null,
  -- Structured specifics: which symbols, how many entries, what was missing.
  detail jsonb,

  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  occurrences   integer not null default 1,

  -- Set when the condition clears. A resolved hold is kept, not deleted:
  -- "we held this and then released it, here is when and why" is the record
  -- worth having.
  resolved_at timestamptz,
  resolution  text
);

-- One OPEN hold per subject per kind. Re-recording updates it. Resolved holds
-- are unconstrained, so the same subject can be held again later and each
-- episode is kept separately.
create unique index if not exists system_holds_open_unique
  on public.system_holds (kind, subject_type, subject_id)
  where resolved_at is null;

create index if not exists system_holds_open_idx
  on public.system_holds (last_seen_at desc) where resolved_at is null;
create index if not exists system_holds_subject_idx
  on public.system_holds (subject_type, subject_id);

alter table public.system_holds enable row level security;

drop policy if exists system_holds_admin_read on public.system_holds;
create policy system_holds_admin_read on public.system_holds
  for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

commit;
