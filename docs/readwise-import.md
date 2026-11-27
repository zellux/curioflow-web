# Import saved articles

Open **Settings → Import → Import articles**, choose your source and select its CSV. Review the article and archive counts, then start the import. Keep the page open while batches are submitted. If a request is interrupted, you can resume. If individual articles fail, retry the file to process them again. Existing URLs are skipped, including archived and deleted articles.

| Source | File to select | Fields carried over |
| --- | --- | --- |
| Readwise Reader | The Reader library CSV | Title, URL, saved date, archive status and reading progress |
| Matter | The history CSV from Settings → Account → Export Data | Title and URL, plus saved date and archive status when the CSV contains them |
| Instapaper | The CSV from Settings → Export | Title, URL, saved date and archive status |
| Pocket | Each CSV from your unzipped Pocket backup | Title, URL, saved date and archive status |

Each CSV can contain up to 20,000 articles and be up to 10 MB. The importer supports quoted commas, escaped quotes, multiline fields and UTF-8 BOMs. It accepts HTTP(S) article URLs and fetches content in the background. Tags, folders, highlights, notes and saved copies of article content are outside this import. Matter's separate library ZIP is also outside this import.

## Readwise command line

The Readwise CSV requires the `Title`, `URL`, `Saved date`, `Location` and `Reading progress` columns. Reader items in locations other than Archive are added to the Library. Forwarded emails with `mailto:` URLs are skipped.

For unattended imports, run in the target app environment:

```sh
npm run import:readwise -- --file /path/export.csv --library LIBRARY_ID
npm run import:readwise -- --file /path/export.csv --library LIBRARY_ID --apply --report /path/result.json
```

Without `--apply`, no articles, sources, or jobs are created. Reports include counts and per-URL errors; keep them private. The report path must not already exist. Imports use the normal article ingestion queue; queued does not mean extraction has completed.
