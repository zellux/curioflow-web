# Article image cache

New article imports and explicit refetches save supported body images under
`storage/article-images/<last-two-ID-characters>/<full-article-ID>/<sha256>.<extension>`.
The article ID is the importing item's database ID; refetches use the same ID. Docker app and worker containers already share this
persistent storage volume. Back up this directory with the rest of `storage`.
Image bytes are not stored in the database: article HTML contains local image
URLs and retains each original URL in `data-original-src`.

Files are named by a SHA-256 content hash, so identical images within an article share one file. Different article IDs
have separate directories even when their image bytes match.
Writes use a temporary file and atomic rename. The image endpoint checks article access and accepts a valid session or a signed
URL for one exact image belonging to one active article. Browser responses are
private and may be cached for one hour.

Downloads follow the existing public-network and redirect policy. Each article
attempts up to 40 distinct image URLs within a 30-second scheduling budget, with
an 8-second request timeout, 8 MiB per image and 64 MiB of downloaded image data
per article. PNG, JPEG, GIF, WebP and AVIF are identified by their file signatures.
Unsupported formats (including SVG), failed downloads and failed disk writes
keep their original URLs. Limits also leave remaining images remote.

Previously imported articles are not rewritten automatically. Use **Refetch** to
cache their images. Reusing an existing document copies its local images into the new item's own
directory without downloading them again; copy failures use original remote URLs.
Old flat and first-two-character image URLs remain readable; new downloads use the directory layout above.
This change covers the web article import pipeline, including RSS articles that
use it; it does not process newsletter or PDF assets.

Web and native readers use cached images. Mobile sync supplies absolute URLs
using `CURIOFLOW_APP_URL` (or the request origin in development). Each native image
URL carries an HMAC signature bound to its article ID and exact image path. It
does not expose the login cookie and needs no WebView cookie sharing. The server
also checks that the article still exists, is not deleted, and references that
image. Links remain usable while those conditions hold; deleting the article or
rotating the signing key revokes server access. Already downloaded device/browser
copies are not remotely erased. Migration 0012 resyncs existing cached-image items.

Signing uses `CURIOFLOW_SECRET_KEY`. Development installations without that key
persist a random key in `storage/.article-image-key`; include it in backups.
Local image files are not included in account-export downloads.

Deletion in Web/mobile and source removal with `keepItems=false` attempt cleanup
after the database transaction commits. Archived and unsaved articles keep their
images. Cleanup waits if another active article references the directory or a
related job is queued/running. It restores original URLs in retained document
caches before deleting the item's image directories, so cached text can still be
reused. The worker retries deferred/failed cleanup and removes orphaned item
directories every five minutes. Legacy flat files are retained because they lack
an article owner; the automated cleanup covers current and old prefix-sharded
article directories.

Article IDs use the existing Prisma `cuid()` default on `Item.id`. The last two
characters come from CUID v1's random suffix and group articles into directories.
Existing article IDs are unchanged.
This feature does not change article IDs.
