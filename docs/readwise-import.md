# Import Readwise Reader articles

Open **Settings → Import → Readwise Reader** and select the CSV exported by Reader. Review the number of articles, then import. Keep the page open while batches are submitted; content extraction and summaries continue in the background afterward. A failed request can be resumed. Reselecting the file is safe: existing articles are skipped.

The importer accepts up to 10 MB / 20,000 rows and requires the `Title`, `URL`, `Saved date`, `Location`, and `Reading progress` columns. It handles quoted commas, escaped quotes, multiline fields, and UTF-8 BOMs.

URLs are normalized using the normal article import rules. Existing URLs, canonical content URLs, and source-entry URLs are checked within the target library, including archived and deleted articles. Their state is never overwritten. New articles preserve saved dates, reading progress, and archive status. Other Reader locations (new, later, feed) enter Library. Tags, highlights, and Readwise-specific reading positions are not imported. Only HTTP(S) URLs can be fetched; Reader's `mailto:reader-forwarded-email/...` references are skipped because the CSV does not include the email content.

For unattended imports, run in the target app environment:

```sh
npm run import:readwise -- --file /path/export.csv --library LIBRARY_ID
npm run import:readwise -- --file /path/export.csv --library LIBRARY_ID --apply --report /path/result.json
```

Without `--apply`, no articles, sources, or jobs are created. Reports include counts and per-URL errors; keep them private. The report path must not already exist. Imports use the normal article ingestion queue; queued does not mean extraction has completed.
