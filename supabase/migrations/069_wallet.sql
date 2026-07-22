-- Real-money wallet: one ledger row per deposit, withdrawal, win, entry
-- fee, or refund. Balance is always derived by summing this table, never
-- stored as a mutable column, so the ledger itself is the accounting
-- record (nothing to drift out of sync).
--
-- Deposits are inserted only by the Stripe webhook once payment actually
-- clears (status starts and stays 'completed'). Withdrawals are inserted
-- 'pending' the moment a user requests one — the funds are held out of
-- their available balance immediately, then flipped to 'completed' (paid
-- out) or 'canceled' (returned) by whoever fulfills the payout.

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('deposit', 'withdrawal', 'win', 'entry_fee', 'refund')),
  -- Signed: deposits/wins/refunds are positive, withdrawals/entry_fees are negative.
  amount numeric not null,
  status text not null default 'completed'
    check (status in ('pending', 'completed', 'failed', 'canceled')),
  stripe_reference text,
  description text,
  created_at timestamptz not null default now(),
  constraint wallet_amount_sign check (
    (type in ('deposit', 'win', 'refund') and amount > 0)
    or (type in ('withdrawal', 'entry_fee') and amount < 0)
  )
);

create index if not exists wallet_transactions_user_idx
  on public.wallet_transactions (user_id, created_at desc);

alter table public.wallet_transactions enable row level security;

drop policy if exists "Users read own wallet transactions" on public.wallet_transactions;
create policy "Users read own wallet transactions"
  on public.wallet_transactions for select
  to authenticated
  using (auth.uid() = user_id);

-- No insert/update/delete policy for regular users — every write goes
-- through the service-role client (Stripe webhook, withdrawal API, future
-- entry-fee/payout code), never directly from the client.
