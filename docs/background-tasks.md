# Background ingestion and task monitoring

The self-hosted Web app runs subscription ingestion without an open browser. Production
uses the existing `worker` Compose service (`CURIOFLOW_RUN_BACKGROUND_WORKER=true`);
the web service keeps that setting `false`. Development runs background work by default.

## Scheduling and recovery

- The scheduler scans every 30 seconds without overlapping its own previous tick.
- RSS/Atom and podcast refresh cadence remains 15 minutes–24 hours (default 60 minutes),
  with jitter and failure backoff. Existing conditional HTTP requests are retained.
- Manual subscriptions and periodic fetches use the same enqueue helper. A database
  partial unique index permits at most one queued/running fetch per `source_id`.
- Existing jobs with no indexed source ID are recognized from their payload while they
  drain; historical jobs are not rewritten or deleted by this migration.
- Expired leases are recovered by the existing dispatcher. Owners/versions fence job
  completion, and transient heartbeat write failures are caught.
- With concurrency greater than one, one slot is reserved for source/email ingestion.
  Other work uses the remaining capacity. With concurrency one, work remains serial.
  Dispatch inspects ingestion separately so an older summary backlog cannot hide it.
- Failed jobs use the existing bounded retry schedule (three attempts by default).
  A terminal source fetch failure does not stop future periodic checks.

## Incoming newsletters

SES → S3 → SQS remains the supported email connection. Gmail/IMAP mailbox synchronization
is a separate future connector, not part of this implementation.

The SQS consumer validates the recipient and configured bucket, durably upserts an
`ingest_newsletter` job, then acknowledges the notification. A stable hash of recipient
ID and provider message ID prevents repeated notifications from creating multiple jobs.
It stores the notification, not the email body, in the task payload. Unknown/disabled
recipients are acknowledged without importing content.

A normal worker downloads the raw email, parses/sanitizes it, and uses the existing
newsletter grouping and inbox semantics. Downloads have a 60-second timeout and a 25 MB
size limit. Parsing failures are visible as failed tasks and can be retried independently
of SQS. A crash after import but before task completion is safe to replay because inbound
message deduplication preserves existing item state.

Configure SQS redrive to a dead-letter queue for malformed notifications that cannot be
assigned to a library. Queue infrastructure is not provisioned by this code. SQS visibility
only covers durable enqueue/acknowledgement (120 seconds); expensive parsing no longer
runs under that visibility window. Failed queue polls back off up to 60 seconds.
Retain S3 objects long enough for manual task retries; deleting them prevents replay.

## Settings → Background tasks

Direct link: `/settings?settingsTab=tasks`.

- Scheduler and email receiver heartbeat/last successful check. A heartbeat older than
  90 seconds is unavailable; recent activity without recent success is degraded.
- Current queued/running counts; completed/failed counts for the last 24 hours.
- Last 24 hours of activity plus older pending tasks, capped at 100 rows, filterable by
  status. Old jobs completing today appear even if created earlier.
- Task type/source, timestamps, attempts, progress, retry time, categorized failure,
  email outcome, and a retry action for supported failed tasks.
- Oldest queued timestamp and count of subscriptions overdue by more than five minutes.
- Refreshes every ten seconds only while the panel is open and the browser is visible.
  Request failures retain the last snapshot and show that it could not be refreshed.

The API authenticates through the current library and scopes all task reads/retries to
that library. Worker health is shared service status. Raw job payloads, credentials,
provider error messages, and email bodies are never returned by this endpoint.
Retrying a source is rejected if it is inactive or already has a queued/running fetch.

## Rollout and verification

Apply `0013_background_task_monitoring` for the database provider before starting the new
app/worker, and regenerate Prisma Client. SQLite and PostgreSQL migrations are included.
Restart existing Node processes so they load the new client. Keep web and worker on the
same revision; an old worker does not recognize newsletter jobs or indexed source IDs.
Do not roll back the worker alone while queued newsletter jobs remain.

Validation: `npm run typecheck`, `npm run lint`, and `npm run test:state`. The background
workflow test uses an isolated temporary SQLite database and mocked S3; it covers
concurrent enqueue, source scheduling, stale lease recovery, tenant isolation, manual
retry conflicts, repeated email delivery, and preserving archived items. Live AWS access
and PostgreSQL deployment are separate environment checks.

SQLite deployments also apply `0014_normalize_source_schedule_dates`: it converts legacy
text `next_fetch_at` values to Prisma's Unix-millisecond storage, preserving the scheduled
instant. Without it, old subscriptions can appear healthy but never match the due query.
PostgreSQL already uses typed timestamps and needs no equivalent data repair.
