-- price_log_latest and price_log_today_anchors (091) were created without
-- security_invoker, so they ran with the view owner's privileges and
-- silently bypassed price_log's admin-only RLS policy for any caller with
-- just the public anon key. Every real app usage already goes through the
-- service-role client (unaffected either way) -- this just closes the
-- direct-API bypass. Re-declared with the same query, just security_invoker
-- added; Postgres requires a full `create or replace` to change view options.

begin;

create or replace view public.price_log_latest
with (security_invoker = true) as
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

create or replace view public.price_log_today_anchors
with (security_invoker = true) as
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
