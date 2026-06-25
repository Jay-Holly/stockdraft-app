-- =============================================================================
-- StockDraft: delete all test users and their data
--
-- PRESERVES: whyde_ide@yahoo.com and every league / draft / roster row tied
--            to that account (including synthetic bots in those leagues).
--
-- ALSO PRESERVES: the 12 seeded platform AI bot profiles (a1000001-…001–012).
--
-- RUN IN: Supabase Dashboard → SQL Editor (postgres / service role)
--
-- Review the preview block output before uncommenting COMMIT.
-- Leave ROLLBACK in place on first run if you want a dry run (see bottom).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0) Resolve the account to keep
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_keep_email constant text := 'whyde_ide@yahoo.com';
  v_keep_id uuid;
BEGIN
  SELECT u.id
  INTO v_keep_id
  FROM auth.users u
  WHERE lower(u.email) = lower(v_keep_email);

  IF v_keep_id IS NULL THEN
    RAISE EXCEPTION 'Keeper account % was not found in auth.users — aborting.', v_keep_email;
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _cleanup_keep (user_id uuid PRIMARY KEY);
  TRUNCATE _cleanup_keep;
  INSERT INTO _cleanup_keep (user_id) VALUES (v_keep_id);

  RAISE NOTICE 'Keeping user_id % (%)', v_keep_id, v_keep_email;
END $$;

-- ---------------------------------------------------------------------------
-- 1) Preview (informational — does not modify data)
-- ---------------------------------------------------------------------------
SELECT 'auth.users to delete' AS label, count(*) AS row_count
FROM auth.users u
WHERE u.id <> (SELECT user_id FROM _cleanup_keep);

SELECT 'leagues to delete (keeper not a member)' AS label, count(*) AS row_count
FROM public.leagues l
WHERE NOT EXISTS (
  SELECT 1
  FROM public.league_members lm
  WHERE lm.league_id = l.id
    AND lm.user_id = (SELECT user_id FROM _cleanup_keep)
);

SELECT 'profiles to delete (estimate)' AS label, count(*) AS row_count
FROM public.profiles p
WHERE p.id <> (SELECT user_id FROM _cleanup_keep)
  AND p.id NOT IN (
    -- Seeded platform AI bots — not test accounts
    'a1000001-0001-4001-8001-000000000001',
    'a1000001-0001-4001-8001-000000000002',
    'a1000001-0001-4001-8001-000000000003',
    'a1000001-0001-4001-8001-000000000004',
    'a1000001-0001-4001-8001-000000000005',
    'a1000001-0001-4001-8001-000000000006',
    'a1000001-0001-4001-8001-000000000007',
    'a1000001-0001-4001-8001-000000000008',
    'a1000001-0001-4001-8001-000000000009',
    'a1000001-0001-4001-8001-000000000010',
    'a1000001-0001-4001-8001-000000000011',
    'a1000001-0001-4001-8001-000000000012'
  )
  AND NOT (
    p.is_bot = true
    AND EXISTS (
      SELECT 1
      FROM public.league_members lm
      WHERE lm.user_id = p.id
        AND lm.league_id IN (
          SELECT league_id
          FROM public.league_members
          WHERE user_id = (SELECT user_id FROM _cleanup_keep)
        )
    )
  );

-- ---------------------------------------------------------------------------
-- 2) Drop leagues the keeper is not in (cascades league_* tables, drafts, etc.)
-- ---------------------------------------------------------------------------
DELETE FROM public.leagues l
WHERE NOT EXISTS (
  SELECT 1
  FROM public.league_members lm
  WHERE lm.league_id = l.id
    AND lm.user_id = (SELECT user_id FROM _cleanup_keep)
);

-- ---------------------------------------------------------------------------
-- 3) Re-sync live draft order arrays for surviving leagues
--    (uuid[] columns are not FK-enforced — prune removed managers)
-- ---------------------------------------------------------------------------
UPDATE public.league_draft_state lds
SET
  draft_order = ordered.member_ids,
  on_clock_user_id = CASE
    WHEN lds.on_clock_user_id IS NOT NULL
      AND lds.on_clock_user_id = ANY (ordered.member_ids)
    THEN lds.on_clock_user_id
    ELSE NULL
  END,
  updated_at = now()
FROM (
  SELECT
    lm.league_id,
    array_agg(lm.user_id ORDER BY lm.draft_slot NULLS LAST, lm.created_at) AS member_ids
  FROM public.league_members lm
  GROUP BY lm.league_id
) ordered
WHERE lds.league_id = ordered.league_id;

-- ---------------------------------------------------------------------------
-- 4) Delete test profiles (cascades league_members, drafts, draft_picks,
--    standings, matchups, roster rows, draft events, etc. for those users)
-- ---------------------------------------------------------------------------
DELETE FROM public.profiles p
WHERE p.id <> (SELECT user_id FROM _cleanup_keep)
  AND p.id NOT IN (
    'a1000001-0001-4001-8001-000000000001',
    'a1000001-0001-4001-8001-000000000002',
    'a1000001-0001-4001-8001-000000000003',
    'a1000001-0001-4001-8001-000000000004',
    'a1000001-0001-4001-8001-000000000005',
    'a1000001-0001-4001-8001-000000000006',
    'a1000001-0001-4001-8001-000000000007',
    'a1000001-0001-4001-8001-000000000008',
    'a1000001-0001-4001-8001-000000000009',
    'a1000001-0001-4001-8001-000000000010',
    'a1000001-0001-4001-8001-000000000011',
    'a1000001-0001-4001-8001-000000000012'
  )
  AND NOT (
    p.is_bot = true
    AND EXISTS (
      SELECT 1
      FROM public.league_members lm
      WHERE lm.user_id = p.id
        AND lm.league_id IN (
          SELECT league_id
          FROM public.league_members
          WHERE user_id = (SELECT user_id FROM _cleanup_keep)
        )
    )
  );

-- ---------------------------------------------------------------------------
-- 5) Orphan synthetic bot profiles (league deleted, no membership left)
-- ---------------------------------------------------------------------------
DELETE FROM public.profiles p
WHERE p.id <> (SELECT user_id FROM _cleanup_keep)
  AND p.is_bot = true
  AND NOT EXISTS (
    SELECT 1 FROM public.league_members lm WHERE lm.user_id = p.id
  )
  AND p.id NOT IN (
    'a1000001-0001-4001-8001-000000000001',
    'a1000001-0001-4001-8001-000000000002',
    'a1000001-0001-4001-8001-000000000003',
    'a1000001-0001-4001-8001-000000000004',
    'a1000001-0001-4001-8001-000000000005',
    'a1000001-0001-4001-8001-000000000006',
    'a1000001-0001-4001-8001-000000000007',
    'a1000001-0001-4001-8001-000000000008',
    'a1000001-0001-4001-8001-000000000009',
    'a1000001-0001-4001-8001-000000000010',
    'a1000001-0001-4001-8001-000000000011',
    'a1000001-0001-4001-8001-000000000012'
  );

-- ---------------------------------------------------------------------------
-- 6) Ensure surviving leagues still have an owner when the old owner was removed
-- ---------------------------------------------------------------------------
UPDATE public.leagues l
SET owner_user_id = (SELECT user_id FROM _cleanup_keep)
WHERE l.owner_user_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.league_members lm
    WHERE lm.league_id = l.id
      AND lm.user_id = (SELECT user_id FROM _cleanup_keep)
  );

-- ---------------------------------------------------------------------------
-- 7) Remove every other auth account (cascades auth.identities, sessions, etc.)
-- ---------------------------------------------------------------------------
DELETE FROM auth.users u
WHERE u.id <> (SELECT user_id FROM _cleanup_keep);

-- ---------------------------------------------------------------------------
-- 8) Reset legacy global crypto surcharge counters (optional platform table)
-- ---------------------------------------------------------------------------
UPDATE public.crypto_buyer_counts
SET buyer_count = 0;

-- ---------------------------------------------------------------------------
-- 9) Post-cleanup verification
-- ---------------------------------------------------------------------------
SELECT 'remaining auth.users' AS label, u.id, u.email
FROM auth.users u;

SELECT 'remaining human profiles' AS label, p.id, p.username, p.team_name
FROM public.profiles p
WHERE p.is_bot = false;

SELECT 'keeper leagues' AS label, l.id, l.name, l.league_type, l.status
FROM public.leagues l
WHERE EXISTS (
  SELECT 1
  FROM public.league_members lm
  WHERE lm.league_id = l.id
    AND lm.user_id = (SELECT user_id FROM _cleanup_keep)
);

-- Uncomment ONE of the following after reviewing the verification output:
COMMIT;
-- ROLLBACK;  -- use instead of COMMIT for a dry run
