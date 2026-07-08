-- Surfaces scheduled-draft / bot-fill failures in the draft waiting room.

alter table public.leagues add column if not exists scheduled_draft_last_error text;
alter table public.leagues add column if not exists scheduled_draft_last_attempt_at timestamptz;

comment on column public.leagues.scheduled_draft_last_error is
  'Last bot-fill or draft-start failure for a due scheduled draft; cleared when status becomes drafting.';
