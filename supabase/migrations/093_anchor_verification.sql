-- 093_anchor_verification.sql
--
-- Corroboration, stored next to the price it corroborates.
--
-- An anchor (the open or close a contest settles on) is now captured from a
-- consolidated-tape source, and checked at the same moment against a second,
-- independent source that was already fetched for other reasons. Recording the
-- second opinion in the same row means the evidence and the number can never
-- drift apart, get joined incorrectly, or be produced separately after the
-- fact. The row says: this was the price, this is who else agreed, this is how
-- far apart they were, and this is what we concluded.
--
-- Why this is worth a column rather than a log line: for SDDFS and SDWFS real
-- money moves on these numbers. The defensible record is not "our system said
-- $319.70" — it is "two sources that do not know each other produced $319.70
-- and $319.58 at the same instant, 0.038% apart, inside tolerance, and here is
-- the append-only row that has never been edited."
--
-- Additive only. Every column is nullable and nothing existing changes.

begin;

alter table public.price_log
  add column if not exists verified_price   numeric(20, 8)
    check (verified_price is null or verified_price > 0),
  add column if not exists verified_source  text
    check (verified_source is null or verified_source in
      ('finnhub', 'coingecko', 'twelvedata', 'alpaca', 'manual')),
  add column if not exists verify_diff_pct  numeric(12, 6),
  -- ok           — both sources inside tolerance
  -- divergent    — they disagree beyond tolerance; needs a third opinion
  -- unverified   — only one source produced a price; not wrong, just
  --                single-sourced, and reported as such rather than trusted
  -- recovered    — the primary had nothing; this value came from a fallback
  --                source and is corroborated by it alone
  add column if not exists verify_status    text
    check (verify_status is null or verify_status in
      ('ok', 'divergent', 'unverified', 'recovered')),
  add column if not exists verified_at      timestamptz;

-- The exception queue: anchors that need a third source. Deliberately narrow
-- so the audit's limited per-minute budget is spent only where two sources
-- actually failed to agree, instead of re-confirming symbols nobody doubted.
create index if not exists price_log_needs_third_source_idx
  on public.price_log (session_date desc, symbol)
  where kind in ('open', 'close')
    and superseded_at is null
    and verify_status in ('divergent', 'unverified');

comment on column public.price_log.verify_status is
  'Corroboration of an anchor by a second independent source at capture time. '
  'Only divergent/unverified rows are worth spending third-source credits on.';

commit;
