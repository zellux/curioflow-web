CREATE UNIQUE INDEX account_exports_one_active_per_account_key
  ON account_exports (account_id)
  WHERE status IN ('queued', 'running');
