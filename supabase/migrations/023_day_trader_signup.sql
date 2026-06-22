-- Track Day Trader mode signups on user profiles

alter table public.profiles
  add column if not exists day_trader_joined_at timestamptz;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (
    id,
    username,
    team_name,
    avatar_color,
    day_trader_joined_at
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'username', 'player_' || substr(new.id::text, 1, 8)),
    coalesce(new.raw_user_meta_data ->> 'team_name', 'My Team'),
    coalesce(new.raw_user_meta_data ->> 'avatar_color', 'blue'),
    case
      when coalesce(new.raw_user_meta_data ->> 'day_trader_signup', 'false') = 'true'
        then now()
      else null
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
