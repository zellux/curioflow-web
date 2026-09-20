# Article image cache

New article imports and explicit refetches save supported body images under
`storage/article-images/<last-two-ID-characters>/<full-article-ID>/<sha256>.<extension>`.
The article ID is the importing item's database ID; refetches use the same ID. Docker app and worker containers already share this
persistent storage volume. Back up this directory with the rest of `storage`.
Image bytes are not stored in the database: article HTML contains local image
URLs and retains each original URL in `data-original-src`.

Files are named by a SHA-256 content hash, so identical images within an article share one file. Different article IDs
have separate directories even when their image bytes match.
Writes use a temporary file and atomic rename. The image endpoint requires a
valid session and serves immutable, private browser-cache responses.

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

Web readers use cached images. Native mobile sync currently restores the
original URLs because native article views use the article's origin as their base
URL and do not share browser session cookies. Local image files are not included
in account-export downloads. No automatic cache garbage collection is performed.

Article IDs use the existing Prisma `cuid()` default on `Item.id`. The last two
characters come from CUID v1's random suffix and group articles into directories.
Existing article IDs are unchanged.
This feature does not change IDs or add automatic image deletion.
