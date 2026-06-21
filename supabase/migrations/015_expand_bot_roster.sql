-- Expand AI bot roster to 12 personalities + per-league bot config

alter table public.league_members drop constraint if exists league_members_bot_personality_check;

alter table public.league_members add constraint league_members_bot_personality_check
  check (
    bot_personality is null
    or bot_personality in (
      'analyst',
      'gambler',
      'crypto_king',
      'value_hunter',
      'sector_loyalist',
      'contrarian',
      'momentum_chaser',
      'diversifier',
      'day_trader',
      'sleeper',
      'homer',
      'bench_hoarder'
    )
  );

alter table public.league_members add column if not exists bot_config jsonb not null default '{}'::jsonb;

-- 12 bot personalities need more avatar colors than the original 6 user options.
alter table public.profiles drop constraint if exists avatar_color_valid;

alter table public.profiles add constraint avatar_color_valid check (
  avatar_color in (
    'blue',
    'gold',
    'green',
    'red',
    'purple',
    'orange',
    'cyan',
    'teal',
    'yellow',
    'pink',
    'indigo',
    'slate'
  )
);

insert into public.profiles (id, username, team_name, avatar_color, is_bot) values
  ('a1000001-0001-4001-8001-000000000004', 'value_hunter', 'The Value Hunter', 'green', true),
  ('a1000001-0001-4001-8001-000000000005', 'sector_loyalist', 'The Sector Loyalist', 'purple', true),
  ('a1000001-0001-4001-8001-000000000006', 'contrarian', 'The Contrarian', 'orange', true),
  ('a1000001-0001-4001-8001-000000000007', 'momentum_chaser', 'The Momentum Chaser', 'cyan', true),
  ('a1000001-0001-4001-8001-000000000008', 'diversifier', 'The Diversifier', 'teal', true),
  ('a1000001-0001-4001-8001-000000000009', 'day_trader', 'The Day Trader', 'yellow', true),
  ('a1000001-0001-4001-8001-000000000010', 'sleeper', 'The Sleeper', 'pink', true),
  ('a1000001-0001-4001-8001-000000000011', 'homer', 'The Homer', 'indigo', true),
  ('a1000001-0001-4001-8001-000000000012', 'bench_hoarder', 'The Bench Hoarder', 'slate', true)
on conflict (id) do update
  set is_bot = true,
      username = excluded.username,
      team_name = excluded.team_name,
      avatar_color = excluded.avatar_color;
