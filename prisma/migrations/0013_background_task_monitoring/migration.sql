ALTER TABLE jobs ADD COLUMN source_id TEXT;
ALTER TABLE jobs ADD COLUMN dedupe_key TEXT;
CREATE UNIQUE INDEX jobs_dedupe_key_key ON jobs (dedupe_key);
CREATE INDEX jobs_source_id_status_idx ON jobs (source_id, status);
CREATE INDEX jobs_library_id_created_at_idx ON jobs (library_id, created_at);
-- Legacy jobs keep a null source_id; enqueue also checks their payload until they drain.
CREATE UNIQUE INDEX jobs_one_active_source_key ON jobs (source_id)
WHERE type = 'fetch_source' AND status IN ('queued', 'running');
CREATE TABLE worker_heartbeats (
  id TEXT NOT NULL PRIMARY KEY,
  last_seen_at DATETIME NOT NULL,
  last_success_at DATETIME
);
