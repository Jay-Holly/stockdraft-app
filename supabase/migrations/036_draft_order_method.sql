-- Standard league draft order method (commissioner-selected or random at start)

alter table public.leagues add column if not exists draft_order_method text not null default 'random_shuffle'
  check (
    draft_order_method in (
      'random_shuffle',
      'league_id_seeded',
      'primes_midpoint',
      'evens_midpoint',
      'symmetric_outside_in',
      'random_method'
    )
  );

-- Future: sports leagues will reference a prior-season standings snapshot (see sports-league-draft-order.ts)
alter table public.leagues add column if not exists sports_standings_season int;
