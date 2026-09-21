# Import manual dev URLs into production

Run from the Web app checkout with its development database env available. The task loads Next's development environment files. It reads dev only and uses SSH/Docker to call the target app's `saveUrlToLibrary`, the same entry point as the URL import API. The deployed app must include `scripts/register-test-loader.mjs` and use Node 22+ with type stripping.

```sh
npm run sync:dev-urls -- \
  --source-library YOUR_DEV_LIBRARY \
  --target-library YOUR_PROD_LIBRARY \
  --host YOUR_PROD_SSH_HOST \
  --report /tmp/url-sync-preview.json
```

Review the preview, then repeat with `--apply` and a new report filename. Repeat `--source-library` to include a legacy library intentionally. `--container` defaults to `curioflow-app`. SSH must already have noninteractive authentication. Use one sync invocation at a time.

Only nondeleted article URLs with a manual URL source or manual source entry are selected. RSS-only items, PDFs, email, test libraries not explicitly selected, and dev content/state are not copied. Target comparison includes archived/deleted items, normalized content URLs, and source-entry URLs. URL normalization follows the deployed article importer. Existing items are skipped, so rerunning is safe after a partial failure.

`imported` means the normal import entry point accepted the URL; fetching and summary generation continue through the production worker. Check Settings → Background tasks for completion or extraction failures. Existing failed target items are skipped too; retry them through normal task controls.

Reports contain URLs and item IDs; they are created with owner-only permissions and refuse to overwrite existing files. Console output contains counts only. Per-URL errors do not prevent remaining imports and cause a nonzero exit status. If SSH disconnects after submission, run a preview again to discover what completed. No privileged HTTP endpoint or database credentials are transmitted.
