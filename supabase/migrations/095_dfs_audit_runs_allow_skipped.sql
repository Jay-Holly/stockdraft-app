-- RoundStatus in src/lib/dfs/audit.ts is "running" | "passed" | "failed" |
-- "skipped", and upsertRun() writes "skipped" on real code paths (e.g. no
-- picks for a date). The original check constraint (085) never allowed it,
-- so that write throws instead of recording cleanly.
alter table dfs_audit_runs drop constraint if exists dfs_audit_runs_status_check;
alter table dfs_audit_runs add constraint dfs_audit_runs_status_check
  check (status in ('running', 'passed', 'failed', 'skipped'));
