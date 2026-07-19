-- Custom per-league team logos.
-- Team identity (display_name) is already per-league on league_members, so the
-- logo lives there too: a manager can run a different logo in each league.

alter table public.league_members
  add column if not exists logo_url text;

-- Public bucket: logos are shown to every league member on Matchups/My Team,
-- so reads are public and writes are restricted to the owning user's folder.
insert into storage.buckets (id, name, public)
values ('team-logos', 'team-logos', true)
on conflict (id) do update set public = true;

drop policy if exists "Team logos are publicly readable" on storage.objects;
create policy "Team logos are publicly readable"
  on storage.objects for select
  using (bucket_id = 'team-logos');

-- Objects are stored at <user_id>/<league_id>.<ext>, so the first path segment
-- must match the uploader — a user can only write their own logos.
drop policy if exists "Users upload own team logo" on storage.objects;
create policy "Users upload own team logo"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'team-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users update own team logo" on storage.objects;
create policy "Users update own team logo"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'team-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'team-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users delete own team logo" on storage.objects;
create policy "Users delete own team logo"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'team-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
