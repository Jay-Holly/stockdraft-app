-- League-wide matchup scoring mode (locked at creation)

alter table public.leagues add column if not exists scoring_mode text not null default 'percent_gain'
  check (scoring_mode in ('percent_gain', 'dollar_gain'));
