#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.resolve(__dirname, "../public/fonts");

// Modern Chromium UA for variable fonts whose fvar default weight is 400 (Instrument Sans, Source Serif 4, Alegreya).
const VARIABLE_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Non-variable WOFF2 UA for fonts whose variable fvar default weight is <400 (Noto Serif SC = 200,
// Noto Sans SC = 100, Nunito Sans = 200), avoiding the iOS WebKit bug that renders font-weight: 400
// at the Thin/ExtraLight default.
const STATIC_WOFF2_UA =
  "Mozilla/5.0 (Windows NT 6.1; rv:52.0) Gecko/20100101 Firefox/52.0";

const BUNDLES = [
  {
    id: "base-ui",
    cssFile: "base-ui.css",
    sources: [
      {
        url: "https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400..700&family=IBM+Plex+Mono:wght@400;500&display=swap",
        userAgent: VARIABLE_UA
      }
    ]
  },
  {
    id: "reading-serif",
    cssFile: "reading-serif.css",
    sources: [
      {
        url: "https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400..700;1,8..60,400..700&display=swap",
        userAgent: VARIABLE_UA
      },
      {
        url: "https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;600&display=swap",
        userAgent: STATIC_WOFF2_UA,
        rewriteWeights: { "400": "400 500", "600": "600 700" }
      }
    ]
  },
  {
    id: "reading-sans",
    cssFile: "reading-sans.css",
    sources: [
      {
        url: "https://fonts.googleapis.com/css2?family=Nunito+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400;1,600;1,700&display=swap",
        userAgent: STATIC_WOFF2_UA
      },
      {
        url: "https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;600&display=swap",
        userAgent: STATIC_WOFF2_UA,
        rewriteWeights: { "400": "400 500", "600": "600 700" }
      }
    ]
  },
  {
    id: "reading-brush",
    cssFile: "reading-brush.css",
    sources: [
      {
        url: "https://fonts.googleapis.com/css2?family=Alegreya:ital,wght@0,400..700;1,400..700&display=swap",
        userAgent: VARIABLE_UA
      },
      {
        url: "https://cdn.jsdelivr.net/npm/lxgw-wenkai-screen-webfont@1.1.0/lxgwwenkaiscreen.css",
        userAgent: VARIABLE_UA
      }
    ]
  }
];

async function fetchWithRetry(url, userAgent = VARIABLE_UA, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": userAgent }
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
      }
    }
  }
  throw lastError;
}

function stableFontFilename(rawUrl) {
  const parsed = new URL(rawUrl);
  const ext = path.extname(parsed.pathname) || ".woff2";
  const base = path.basename(parsed.pathname, ext).replace(/[^a-zA-Z0-9._-]/g, "_");
  const digest = createHash("sha256").update(rawUrl).digest("hex").slice(0, 10);
  const shortBase = base.slice(0, 40) || "font";
  return `${shortBase}-${digest}${ext}`;
}

async function mapConcurrent(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return results;
}

async function syncBundle(bundle) {
  const assetDir = path.join(OUTPUT_DIR, bundle.id);
  await mkdir(assetDir, { recursive: true });

  const downloaded = new Map();
  const cssParts = [];

  for (const source of bundle.sources) {
    const response = await fetchWithRetry(source.url, source.userAgent);
    const rawCss = await response.text();
    const urlMatches = Array.from(rawCss.matchAll(/url\((['"]?)([^)'"]+)\1\)/g));
    const uniqueAssets = [];

    for (const match of urlMatches) {
      const originalRef = match[2].trim();
      if (originalRef.startsWith("data:")) continue;
      const absoluteUrl = new URL(originalRef, source.url).toString();
      if (!downloaded.has(absoluteUrl)) {
        const filename = stableFontFilename(absoluteUrl);
        downloaded.set(absoluteUrl, { filename, bytes: 0 });
        uniqueAssets.push({ absoluteUrl, filename });
      }
    }

    await mapConcurrent(uniqueAssets, 12, async ({ absoluteUrl, filename }) => {
      const fontResponse = await fetchWithRetry(absoluteUrl, source.userAgent);
      const buffer = Buffer.from(await fontResponse.arrayBuffer());
      await writeFile(path.join(assetDir, filename), buffer);
      downloaded.set(absoluteUrl, { filename, bytes: buffer.length });
    });

    let rewrittenCss = rawCss.replace(/url\((['"]?)([^)'"]+)\1\)/g, (full, _quote, ref) => {
      const trimmed = ref.trim();
      if (trimmed.startsWith("data:")) return full;
      const absoluteUrl = new URL(trimmed, source.url).toString();
      const entry = downloaded.get(absoluteUrl);
      if (!entry) return full;
      return `url('/fonts/${bundle.id}/${entry.filename}')`;
    });

    if (source.rewriteWeights) {
      rewrittenCss = rewrittenCss.replace(/font-weight:\s*(\d+);/g, (full, weight) => {
        const replacement = source.rewriteWeights[weight];
        return replacement ? `font-weight: ${replacement};` : full;
      });
    }

    cssParts.push(`/* Source: ${source.url} */\n${rewrittenCss.trim()}`);
  }

  const combinedCss = `${cssParts.join("\n\n")}\n`;
  await writeFile(path.join(OUTPUT_DIR, bundle.cssFile), combinedCss, "utf8");

  let totalBytes = Buffer.byteLength(combinedCss, "utf8");
  for (const entry of downloaded.values()) {
    totalBytes += entry.bytes;
  }

  return {
    id: bundle.id,
    fileCount: downloaded.size,
    totalBytes
  };
}

async function main() {
  await rm(OUTPUT_DIR, { recursive: true, force: true });
  await mkdir(OUTPUT_DIR, { recursive: true });

  let grandTotalBytes = 0;
  let grandTotalFiles = 0;

  for (const bundle of BUNDLES) {
    const stats = await syncBundle(bundle);
    grandTotalBytes += stats.totalBytes;
    grandTotalFiles += stats.fileCount;
    console.log(
      `${stats.id.padEnd(15)} ${String(stats.fileCount).padStart(4)} files  ${(stats.totalBytes / 1024 / 1024).toFixed(2)} MB`
    );
  }

  await writeFile(
    path.join(OUTPUT_DIR, "LICENSES.md"),
    `# Bundled Web Fonts

All fonts in this directory are licensed under the SIL Open Font License 1.1 (OFL-1.1):

- **Instrument Sans** — Google Fonts (OFL-1.1)
- **IBM Plex Mono** — IBM / Google Fonts (OFL-1.1)
- **Source Serif 4** — Adobe / Google Fonts (OFL-1.1)
- **Nunito Sans** — Vernon Adams et al. / Google Fonts (OFL-1.1)
- **Alegreya** — Huerta Tipográfica / Google Fonts (OFL-1.1)
- **Noto Serif SC** — Google / Adobe (OFL-1.1)
- **Noto Sans SC** — Google / Adobe (OFL-1.1)
- **LXGW WenKai Screen** — LXGW / lxgw-wenkai-screen-webfont@1.1.0 (OFL-1.1)

Regenerate with \`node scripts/sync-fonts.mjs\`.
`,
    "utf8"
  );

  console.log(
    `TOTAL           ${String(grandTotalFiles).padStart(4)} files  ${(grandTotalBytes / 1024 / 1024).toFixed(2)} MB`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
