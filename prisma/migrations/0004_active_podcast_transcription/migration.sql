CREATE UNIQUE INDEX jobs_one_active_podcast_transcription_key
ON jobs (content_object_id)
WHERE type = 'transcribe_podcast' AND status IN ('queued', 'running');
