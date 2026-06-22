-- Multi-symbol safety pick queue (priority order = array order)

alter table public.drafts
  add column if not exists safety_pick_queue text[] not null default '{}';

update public.drafts
set safety_pick_queue = array[safety_pick_symbol]
where safety_pick_symbol is not null
  and cardinality(safety_pick_queue) = 0;
