-- Human-readable league IDs for customer support (e.g. SDFL-00042)

create sequence if not exists public.league_support_code_seq;

alter table public.leagues
  add column if not exists support_code text;

with numbered as (
  select id, row_number() over (order by created_at, id) as rn
  from public.leagues
  where support_code is null
)
update public.leagues l
set support_code = 'SDFL-' || lpad(n.rn::text, 5, '0')
from numbered n
where l.id = n.id;

select setval(
  'public.league_support_code_seq',
  coalesce(
    (
      select max(
        nullif(regexp_replace(support_code, '^SDFL-', ''), '')::bigint
      )
      from public.leagues
    ),
    0
  ) + 1,
  false
);

create or replace function public.set_league_support_code()
returns trigger
language plpgsql
as $$
begin
  if new.support_code is null then
    new.support_code :=
      'SDFL-' || lpad(nextval('public.league_support_code_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists leagues_set_support_code on public.leagues;

create trigger leagues_set_support_code
  before insert on public.leagues
  for each row
  execute function public.set_league_support_code();

alter table public.leagues
  alter column support_code set not null;

create unique index if not exists leagues_support_code_idx
  on public.leagues (support_code);
