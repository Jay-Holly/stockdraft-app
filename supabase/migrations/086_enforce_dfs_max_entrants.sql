-- Makes the entrant cap real.
--
-- The enter routes count entries and refuse once the count reaches
-- max_entrants, which closes the ordinary case but not the concurrent one:
-- two entries arriving together both read 149, both decide there is room, and
-- both insert. The check and the insert are separate statements with nothing
-- holding the contest still between them, so no amount of application-side
-- care fixes it.
--
-- Locking the contest row inside a BEFORE INSERT trigger does. The first
-- transaction to reach a given contest holds that row until it commits, so a
-- second entry for the same contest waits and then counts a state that already
-- includes the first. Entries for different contests never touch the same row
-- and do not block each other.

create or replace function public.enforce_sddfs_max_entrants()
returns trigger
language plpgsql
as $$
declare
  cap int;
  taken int;
begin
  select max_entrants into cap
  from public.sddfs_contests
  where id = new.contest_id
  for update;

  if cap is null then
    return new;
  end if;

  select count(*) into taken
  from public.sddfs_entries
  where contest_id = new.contest_id;

  if taken >= cap then
    raise exception 'contest_full'
      using hint = 'This contest has reached its entrant limit.';
  end if;

  return new;
end;
$$;

drop trigger if exists sddfs_entries_enforce_max_entrants on public.sddfs_entries;
create trigger sddfs_entries_enforce_max_entrants
  before insert on public.sddfs_entries
  for each row execute function public.enforce_sddfs_max_entrants();

create or replace function public.enforce_sdwfs_max_entrants()
returns trigger
language plpgsql
as $$
declare
  cap int;
  taken int;
begin
  select max_entrants into cap
  from public.sdwfs_contests
  where id = new.contest_id
  for update;

  if cap is null then
    return new;
  end if;

  select count(*) into taken
  from public.sdwfs_entries
  where contest_id = new.contest_id;

  if taken >= cap then
    raise exception 'contest_full'
      using hint = 'This contest has reached its entrant limit.';
  end if;

  return new;
end;
$$;

drop trigger if exists sdwfs_entries_enforce_max_entrants on public.sdwfs_entries;
create trigger sdwfs_entries_enforce_max_entrants
  before insert on public.sdwfs_entries
  for each row execute function public.enforce_sdwfs_max_entrants();
