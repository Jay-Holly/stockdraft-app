-- A second, independent id for every coin in the pool.
--
-- CoinGecko alone decides every crypto price we score, and nothing checks it.
-- The obvious way to add a second opinion — ask another provider for the same
-- ticker — is exactly the trap that has now bitten three times in one day:
-- RAIN, MNT and U each resolve on some other provider to a completely
-- different asset (RAIN 2.3x off, MNT ~1600x off), with no error to notice.
-- A ticker is a label, not an identifier.
--
-- So the mapping is stored, not guessed. Each coin's coinpaprika_id is
-- resolved once by price agreement with CoinGecko (see
-- scripts/map-coinpaprika-ids.mjs) and written here. At runtime the audit uses
-- the stored id and treats disagreement as a finding.
--
-- It must never re-resolve by price at runtime: a check that re-picks whichever
-- asset currently matches would agree with itself forever and verify nothing.

alter table public.crypto_pool
  add column if not exists coinpaprika_id text;

comment on column public.crypto_pool.coinpaprika_id is
  'CoinPaprika coin id, resolved once by price agreement with CoinGecko and verified. Never re-resolve at runtime — see migration 087.';
