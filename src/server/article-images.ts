import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { fetchBytesWithPolicy } from "./outbound-http.ts";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_ARTICLE_BYTES = 64 * 1024 * 1024;
const MAX_IMAGES = 40;
const BUDGET_MS = 30_000;
export const ARTICLE_IMAGE_PREFIX = "/api/article-images/";
const IMAGE_TYPES = {
  png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif"
} as const;
type ImageExtension = keyof typeof IMAGE_TYPES;

function imageExtension(bytes: Uint8Array): ImageExtension | null {
  const buffer = Buffer.from(bytes);
  if (buffer.length < 12) return null;
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpg";
  if (["GIF87a", "GIF89a"].includes(buffer.toString("ascii", 0, 6))) return "gif";
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (buffer.toString("ascii", 4, 8) === "ftyp" && ["avif", "avis"].includes(buffer.toString("ascii", 8, 12))) return "avif";
  return null;
}

export function articleImageDirectory() {
  return join(process.cwd(), "storage", "article-images");
}

function validArticleId(articleId: string) {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,127}$/.test(articleId);
}

export async function readArticleImage(path: string | string[], directory = articleImageDirectory()) {
  const parts = typeof path === "string" ? [path] : path;
  // Read legacy flat/prefix-sharded URLs too. New writes use the last two ID characters.
  if (parts.length !== 1 && parts.length !== 3) return null;
  if (parts.length === 3 && (!validArticleId(parts[1]) || ![parts[1].slice(-2), parts[1].slice(0, 2)].includes(parts[0]))) return null;
  const filename = parts.at(-1)!;
  const match = /^([a-f0-9]{64})\.(png|jpg|gif|webp|avif)$/.exec(filename);
  if (!match) return null;
  try {
    const bytes = await readFile(join(directory, ...parts));
    return { bytes, contentType: IMAGE_TYPES[match[2] as ImageExtension] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

type CacheOptions = {
  directory?: string;
  fetchImage?: typeof fetchBytesWithPolicy;
};

/** Best effort: a failed image must never fail an otherwise readable article. */
export async function cacheArticleImages(html: string | null, articleUrl: string, articleId: string, options: CacheOptions = {}) {
  if (!html || !validArticleId(articleId)) return html;
  const dom = new JSDOM(html);
  const shard = articleId.slice(-2);
  const directory = join(options.directory ?? articleImageDirectory(), shard, articleId);
  const fetchImage = options.fetchImage ?? fetchBytesWithPolicy;
  const deadline = Date.now() + BUDGET_MS;
  let remainingBytes = MAX_ARTICLE_BYTES;
  const downloads = new Map<string, string | null>();
  try {
    for (const image of dom.window.document.querySelectorAll("img")) {
      const source = image.getAttribute("data-src") || image.getAttribute("src");
      if (!source || source.startsWith(ARTICLE_IMAGE_PREFIX)) continue;
      let url: URL;
      try { url = new URL(source, articleUrl); } catch { continue; }
      if (!["http:", "https:"].includes(url.protocol)) continue;
      // Relative remote URLs must not become requests against the Curioflow host.
      image.setAttribute("src", url.href);
      if (!downloads.has(url.href)) {
        if (downloads.size >= MAX_IMAGES || Date.now() >= deadline || remainingBytes <= 0) continue;
        downloads.set(url.href, null);
        let temporaryPath: string | undefined;
        try {
          const response = await fetchImage(url.href, {
            acceptedContentTypes: ["image/", "application/octet-stream"],
            maxBytes: Math.min(MAX_IMAGE_BYTES, remainingBytes),
            timeoutMs: Math.min(8_000, Math.max(1, deadline - Date.now())),
            headers: { "user-agent": "Mozilla/5.0", accept: "image/avif,image/webp,image/*", referer: articleUrl }
          });
          remainingBytes -= response.bytes.byteLength;
          const extension = imageExtension(response.bytes);
          // SVG and non-image responses remain remote; never serve active content locally.
          if (!extension) continue;
          const hash = createHash("sha256").update(response.bytes).digest("hex");
          const filename = `${hash}.${extension}`;
          await mkdir(directory, { recursive: true });
          temporaryPath = join(directory, `.${randomUUID()}.tmp`);
          await writeFile(temporaryPath, response.bytes, { mode: 0o600 });
          await rename(temporaryPath, join(directory, filename));
          downloads.set(url.href, `${ARTICLE_IMAGE_PREFIX}${shard}/${articleId}/${filename}`);
        } catch {
          // HTTP, timeout, size, network-policy and disk errors all keep the source URL.
        } finally {
          if (temporaryPath) await unlink(temporaryPath).catch(() => undefined);
        }
      }
      const localUrl = downloads.get(url.href);
      if (!localUrl) continue;
      image.setAttribute("data-original-src", url.href);
      image.setAttribute("src", localUrl);
      image.removeAttribute("srcset");
      image.removeAttribute("data-src");
      image.removeAttribute("data-srcset");
      image.closest("picture")?.querySelectorAll("source").forEach((source) => source.remove());
    }
    return dom.window.document.body.innerHTML;
  } catch {
    return html;
  } finally {
    dom.window.close();
  }
}

/** Reused document text must not make one item depend on another item's files. */
export async function copyArticleImagesForItem(html: string | null, articleId: string, directory = articleImageDirectory()) {
  if (!html || !validArticleId(articleId) || !html.includes(ARTICLE_IMAGE_PREFIX)) return html;
  const dom = new JSDOM(html);
  const ownPrefix = `${ARTICLE_IMAGE_PREFIX}${articleId.slice(-2)}/${articleId}/`;
  const destination = join(directory, articleId.slice(-2), articleId);
  const copies = new Map<string, string | null>();
  let changed = false;
  try {
    for (const image of dom.window.document.querySelectorAll("img")) {
      const source = image.getAttribute("src");
      if (!source?.startsWith(ARTICLE_IMAGE_PREFIX) || source.startsWith(ownPrefix)) continue;
      changed = true;
      if (!copies.has(source)) {
        copies.set(source, null);
        let temporaryPath: string | undefined;
        try {
          const parts = source.slice(ARTICLE_IMAGE_PREFIX.length).split("/");
          const file = await readArticleImage(parts, directory);
          if (file) {
            const filename = parts.at(-1)!;
            await mkdir(destination, { recursive: true });
            temporaryPath = join(destination, `.${randomUUID()}.tmp`);
            await writeFile(temporaryPath, file.bytes, { mode: 0o600 });
            await rename(temporaryPath, join(destination, filename));
            copies.set(source, `${ownPrefix}${filename}`);
          }
        } catch {
          // Keep using the original remote image if the local copy cannot be made.
        } finally {
          if (temporaryPath) await unlink(temporaryPath).catch(() => undefined);
        }
      }
      const copied = copies.get(source);
      const original = image.getAttribute("data-original-src");
      if (copied) image.setAttribute("src", copied);
      else if (original && /^https?:\/\//i.test(original)) image.setAttribute("src", original);
      else image.removeAttribute("src");
      image.removeAttribute("srcset");
      image.removeAttribute("data-src");
      image.removeAttribute("data-srcset");
      image.closest("picture")?.querySelectorAll("source").forEach((source) => source.remove());
    }
    return changed ? dom.window.document.body.innerHTML : html;
  } finally {
    dom.window.close();
  }
}
