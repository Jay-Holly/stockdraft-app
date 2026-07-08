-- SDFL snake draft: persisted at draft start so in-progress leagues never flip mid-draft.

alter table public.league_draft_state
  add column if not exists use_snake_order boolean not null default false;

comment on column public.league_draft_state.use_snake_order is
  'True when this live draft was started as format_type=sports_league (snake rounds). Immutable after insert.';
