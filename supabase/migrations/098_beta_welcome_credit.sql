-- Every new signup gets a one-time 1,000 StockDuel Bucks welcome credit,
-- granted the moment their profile is created. Existing accounts that
-- signed up before this trigger existed get the same credit retroactively
-- via ensureBetaWelcomeCredit() (src/lib/wallet/ledger.ts), called from
-- league creation. The description string here must exactly match
-- BETA_WELCOME_CREDIT_DESCRIPTION in that file -- it's the idempotency key
-- both paths use to make sure nobody is ever credited twice.

begin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, username, team_name, avatar_color)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'username', 'player_' || substr(new.id::text, 1, 8)),
    coalesce(new.raw_user_meta_data ->> 'team_name', 'My Team'),
    coalesce(new.raw_user_meta_data ->> 'avatar_color', 'blue')
  )
  on conflict (id) do nothing;

  insert into public.wallet_transactions (user_id, type, amount, status, description)
  values (new.id, 'deposit', 1000, 'completed', 'StockDuel Bucks beta welcome credit')
  on conflict do nothing;

  return new;
end;
$$;

commit;
