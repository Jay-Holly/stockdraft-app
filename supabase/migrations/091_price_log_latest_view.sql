-- 091_price_log_latest_view.sql
--
-- Read-side helper for the admin Prices page: one row per symbol showing its
-- most recent observation, whatever kind it was and whether it succeeded.
--
-- Without this the admin page would pull raw price_log rows (thousands per
-- day once sampling is running) and reduce them to "latest per symbol" in
-- application code every time the page polls. The view does that reduction
-- once, in the database, using the index migration 089 already created for
-- exactly this (price_log_latest_idx on (symbol, captured_at desc)).

begin;

create or replace view public.price_log_latest as
select distinct on (symbol)
  symbol,
  asset_class,
  kind,
  price,
  failure_reason,
  change_percent,
  day_high,
  day_low,
  as_of,
  captured_at,
  source,
  sweep_id,
  set_by,
  note
from public.price_log
where superseded_at is null
order by symbol, captured_at desc;

-- Today's anchors specifically — separate from "latest", since a stock's
-- most recent row is usually a sample, not the open or close.
create or replace view public.price_log_today_anchors as
select
  symbol,
  asset_class,
  kind,
  price,
  as_of,
  captured_at,
  source,
  set_by,
  note
from public.price_log
where superseded_at is null
  and price is not null
  and kind in ('open', 'close')
  and session_date = (now() at time zone 'America/New_York')::date;

commit;
