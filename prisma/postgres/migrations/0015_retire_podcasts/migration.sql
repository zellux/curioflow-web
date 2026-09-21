-- Retire scheduling without deleting saved content or exportable historical records.
UPDATE sources SET status = 'disabled', next_fetch_at = NULL WHERE type = 'podcast';

UPDATE jobs SET status = 'cancelled', finished_at = CURRENT_TIMESTAMP, next_run_at = NULL,
  locked_until = NULL, lease_owner = NULL, error = NULL
WHERE status IN ('queued', 'running', 'failed') AND (
  type = 'transcribe_podcast' OR
  (type = 'fetch_source' AND (
    source_id IN (SELECT id FROM sources WHERE type = 'podcast') OR
    payload_json LIKE '%"feedTitle"%' OR payload_json LIKE '%"episodes"%'
  ))
);

DROP INDEX IF EXISTS jobs_one_active_podcast_transcription_key;
