// X Articles use Draft-style blocks, but GraphQL style names are title-cased
// and entityMap is an array of { key, value } entries rather than a record.
export type TwitterArticleContent = {
  content_state?: { blocks?: unknown; entityMap?: unknown };
  media_entities?: unknown;
};

export type TwitterNoteTweetContent = {
  id?: unknown;
  text?: unknown;
  entity_set?: { urls?: unknown };
  richtext?: { richtext_tags?: unknown };
  media?: { inline_media?: unknown };
};

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  return value !== null && typeof value === "object" ? value as RecordValue : {};
}
function escape(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function safeUrl(value: unknown, image = false): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["https:", "http:", ...(!image ? ["mailto:"] : [])].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}
function ranges(value: unknown, length: number): (RecordValue & { start: number; end: number })[] {
  return (Array.isArray(value) ? value : []).map(record).filter((range) =>
    Number.isInteger(range.offset) && Number.isInteger(range.length)
    && Number(range.offset) >= 0 && Number(range.offset) < length && Number(range.length) > 0
  ).map((range) => ({ ...range, start: Number(range.offset), end: Math.min(length, Number(range.offset) + Number(range.length)) }));
}

const blockTags = new Map(Object.entries({
  "header-one": "h1", "header-two": "h2", "header-three": "h3",
  "header-four": "h4", "header-five": "h5", "header-six": "h6",
  blockquote: "blockquote"
}));
const styleTags = new Map(Object.entries({
  BOLD: "strong", ITALIC: "em", UNDERLINE: "u", STRIKETHROUGH: "s", CODE: "code"
}));

export function renderTwitterArticleContent(article: TwitterArticleContent): string {
  const blocks = article.content_state?.blocks;
  if (!Array.isArray(blocks)) return "";
  const rawEntities = article.content_state?.entityMap;
  const entities = new Map<string, RecordValue>(Array.isArray(rawEntities)
    ? rawEntities.map((entry) => [String(record(entry).key), record(record(entry).value)])
    : Object.entries(record(rawEntities)).map(([key, value]) => [key, record(value)]));
  const media = new Map((Array.isArray(article.media_entities) ? article.media_entities : [])
    .map((entry) => [String(record(entry).media_id), record(entry)]));

  function inline(block: RecordValue, text: string, pre = false) {
    const styles = ranges(block.inlineStyleRanges, text.length).map((range) => ({
      ...range, style: String(range.style).toUpperCase()
    })).filter((range) => styleTags.has(range.style));
    const links = ranges(block.entityRanges, text.length).flatMap((range) => {
      const entity = entities.get(String(range.key));
      const href = entity?.type === "LINK" ? safeUrl(record(entity.data).url) : null;
      return href ? [{ ...range, href }] : [];
    });
    const boundaries = [...new Set([0, text.length, ...[...styles, ...links].flatMap((range) => [range.start, range.end])])].sort((a, b) => a - b);
    return boundaries.slice(0, -1).map((start, i) => {
      let segment = escape(text.slice(start, boundaries[i + 1]));
      if (!pre) segment = segment.replace(/\n/g, "<br>");
      for (const [style, tag] of styleTags) {
        if ((!pre || style !== "CODE") && styles.some((range) => range.style === style && range.start <= start && range.end > start)) {
          segment = `<${tag}>${segment}</${tag}>`;
        }
      }
      const link = links.find((range) => range.start <= start && range.end > start);
      return link ? `<a href="${escape(link.href)}">${segment}</a>` : segment;
    }).join("");
  }

  function atomic(block: RecordValue) {
    const keys = new Set((Array.isArray(block.entityRanges) ? block.entityRanges : []).map((range) => String(record(range).key)));
    return [...keys].map((key) => {
      const entity = entities.get(key);
      if (entity?.type === "DIVIDER") return "<hr>";
      const data = record(entity?.data);
      if (entity?.type === "MEDIA") {
        return (Array.isArray(data.mediaItems) ? data.mediaItems : []).map((item) => {
          const entry = media.get(String(record(item).mediaId));
          const info = record(entry?.media_info);
          const src = safeUrl(info.original_img_url, true);
          if (!src) return "";
          const alt = typeof entry?.ext_alt_text === "string" ? entry.ext_alt_text : "";
          return `<figure><img src="${escape(src)}" alt="${escape(alt)}" loading="lazy"></figure>`;
        }).join("");
      }
      // Unknown embeds retain an available destination instead of injecting HTML.
      const href = safeUrl(data.url);
      return href ? `<p><a href="${escape(href)}">${escape(href)}</a></p>` : "";
    }).join("");
  }

  let html = "";
  const lists: ("ul" | "ol")[] = [];
  let code: string[] | null = null;
  function closeList() { html += `</li></${lists.pop()}>`; }
  function closeCode() {
    if (code) html += `<pre><code>${code.join("\n")}</code></pre>`;
    code = null;
  }
  for (const value of blocks) {
    if (!value || typeof value !== "object") continue;
    const block = record(value);
    const text = typeof block.text === "string" ? block.text : "";
    const type = typeof block.type === "string" ? block.type : "";
    const list = type === "unordered-list-item" ? "ul" : type === "ordered-list-item" ? "ol" : null;
    if (type !== "code-block") closeCode();
    if (list) {
      // Never manufacture missing parent items when a malformed depth jumps.
      const depth = Number.isInteger(block.depth) ? Math.max(0, Math.min(Number(block.depth), lists.length, 32)) : 0;
      while (lists.length > depth + 1) closeList();
      if (lists.length === depth + 1 && lists[depth] !== list) closeList();
      if (lists.length === depth + 1) html += "</li><li>";
      else { html += `<${list}><li>`; lists.push(list); }
      html += inline(block, text);
      continue;
    }
    while (lists.length) closeList();
    if (type === "code-block") {
      code ??= [];
      code.push(inline(block, text, true));
    } else if (type === "atomic") {
      html += atomic(block) || (text.trim() ? `<p>${inline(block, text)}</p>` : "");
    } else {
      const tag = blockTags.get(type) ?? "p";
      html += `<${tag}>${inline(block, text) || "<br>"}</${tag}>`;
    }
  }
  closeCode();
  while (lists.length) closeList();
  return html;
}

type NoteTweetUrlRange = {
  start: number;
  end: number;
  href: string;
  label: string;
  replaceText: boolean;
};

type NoteTweetStyleRange = {
  start: number;
  end: number;
  style: string;
};

type NoteTweetMediaInfo = {
  id: string;
  src: string;
  alt: string;
  isPhoto: boolean;
};

function noteTweetUrlRanges(noteTweet: TwitterNoteTweetContent, chars: string[]): NoteTweetUrlRange[] {
  const rawUrls = noteTweet.entity_set?.urls;
  if (!Array.isArray(rawUrls)) return [];

  const length = chars.length;
  const result: NoteTweetUrlRange[] = [];
  for (const entry of rawUrls) {
    const item = record(entry);
    const indices = Array.isArray(item.indices) ? item.indices : null;
    if (!indices || indices.length < 2) continue;
    const start = Number(indices[0]);
    const end = Number(indices[1]);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || start >= length) {
      continue;
    }
    const clampedEnd = Math.min(length, end);
    const href = safeUrl(item.expanded_url) ?? safeUrl(item.url);
    if (!href) continue;

    const rawSlice = chars.slice(start, clampedEnd).join("");
    const displayUrl = typeof item.display_url === "string" && item.display_url.trim() ? item.display_url.trim() : null;
    const replaceText = /^https?:\/\/t\.co\//i.test(rawSlice);
    result.push({
      start,
      end: clampedEnd,
      href,
      label: replaceText ? (displayUrl ?? href) : rawSlice,
      replaceText
    });
  }

  return result.sort((a, b) => a.start - b.start || b.end - a.end);
}

function noteTweetStyleRanges(noteTweet: TwitterNoteTweetContent, length: number): NoteTweetStyleRange[] {
  const rawTags = noteTweet.richtext?.richtext_tags;
  if (!Array.isArray(rawTags)) return [];

  const result: NoteTweetStyleRange[] = [];
  for (const entry of rawTags) {
    const tag = record(entry);
    const start = Number(tag.from_index);
    const end = Number(tag.to_index);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || start >= length) {
      continue;
    }
    const clampedEnd = Math.min(length, end);
    const types = Array.isArray(tag.richtext_types) ? tag.richtext_types : [];
    for (const rawType of types) {
      const style = String(rawType).toUpperCase();
      if (styleTags.has(style)) {
        result.push({ start, end: clampedEnd, style });
      }
    }
  }

  return result;
}

function noteTweetMediaMap(mediaEntities: unknown): Map<string, NoteTweetMediaInfo> {
  const map = new Map<string, NoteTweetMediaInfo>();
  if (!Array.isArray(mediaEntities)) return map;

  for (const entry of mediaEntities) {
    const item = record(entry);
    const id = typeof item.id_str === "string" && item.id_str.trim()
      ? item.id_str.trim()
      : (typeof item.media_id === "string" || typeof item.media_id === "number" ? String(item.media_id) : "");
    const src = safeUrl(item.media_url_https, true);
    if (!id || !src) continue;
    const alt = typeof item.ext_alt_text === "string" ? item.ext_alt_text : "";
    const type = typeof item.type === "string" ? item.type : "";
    map.set(id, { id, src, alt, isPhoto: type === "photo" || type === "" });
  }

  return map;
}

function renderMediaFigure(info: NoteTweetMediaInfo) {
  return `<figure><img src="${escape(info.src)}" alt="${escape(info.alt)}" loading="lazy"></figure>`;
}

export function extractTwitterNoteTweetText(noteTweet: TwitterNoteTweetContent): string {
  if (typeof noteTweet.text !== "string") return "";
  const chars = Array.from(noteTweet.text);
  const urls = noteTweetUrlRanges(noteTweet, chars).filter((url) => url.replaceText);
  if (urls.length === 0) return noteTweet.text;

  let result = "";
  let cursor = 0;
  for (const url of urls) {
    if (url.start < cursor) continue;
    result += chars.slice(cursor, url.start).join("");
    result += url.href;
    cursor = url.end;
  }
  result += chars.slice(cursor).join("");
  return result;
}

export function renderTwitterNoteTweetContent(noteTweet: TwitterNoteTweetContent, mediaEntities?: unknown): string {
  if (typeof noteTweet.text !== "string") return "";
  const chars = Array.from(noteTweet.text);
  const length = chars.length;
  const urls = noteTweetUrlRanges(noteTweet, chars);
  const styles = noteTweetStyleRanges(noteTweet, length);
  const mediaById = noteTweetMediaMap(mediaEntities);
  const placedMediaIds = new Set<string>();

  const inlineMedia = (Array.isArray(noteTweet.media?.inline_media) ? noteTweet.media.inline_media : [])
    .map(record)
    .map((entry) => {
      const id = typeof entry.media_id === "string" || typeof entry.media_id === "number" ? String(entry.media_id) : "";
      const index = Number(entry.index);
      const info = id ? mediaById.get(id) : undefined;
      return info && Number.isInteger(index) && index >= 0 && index <= length
        ? { index, info }
        : null;
    })
    .filter((entry): entry is { index: number; info: NoteTweetMediaInfo } => Boolean(entry))
    .sort((a, b) => a.index - b.index);

  function wrapStyles(segment: string, offset: number) {
    let styled = segment;
    for (const [style, tag] of styleTags) {
      if (styles.some((range) => range.style === style && range.start <= offset && range.end > offset)) {
        styled = `<${tag}>${styled}</${tag}>`;
      }
    }
    return styled;
  }

  function renderInline(rangeStart: number, rangeEnd: number) {
    const activeLinks = urls.filter((link) => link.end > rangeStart && link.start < rangeEnd);
    const points = new Set<number>([rangeStart, rangeEnd]);

    for (const link of activeLinks) {
      points.add(Math.max(rangeStart, link.start));
      points.add(Math.min(rangeEnd, link.end));
    }
    for (const style of styles) {
      if (style.end <= rangeStart || style.start >= rangeEnd) continue;
      const start = Math.max(rangeStart, style.start);
      const end = Math.min(rangeEnd, style.end);
      // Do not split inside a replaced t.co link so its label is emitted once.
      if (!activeLinks.some((link) => link.replaceText && start > link.start && start < link.end)) {
        points.add(start);
      }
      if (!activeLinks.some((link) => link.replaceText && end > link.start && end < link.end)) {
        points.add(end);
      }
    }

    const boundaries = [...points].sort((a, b) => a - b);
    let out = "";
    for (let i = 0; i < boundaries.length - 1; i++) {
      const start = boundaries[i];
      const end = boundaries[i + 1];
      if (end <= start) continue;

      const link = activeLinks.find((entry) => entry.start <= start && entry.end >= end);
      if (link?.replaceText) {
        if (start === Math.max(rangeStart, link.start)) {
          const styled = wrapStyles(escape(link.label), start);
          out += `<a href="${escape(link.href)}">${styled}</a>`;
        }
        continue;
      }

      const raw = chars.slice(start, end).join("").replace(/\r\n?/g, "\n");
      const escaped = escape(raw).replace(/\n/g, "<br>");
      const styled = wrapStyles(escaped, start);
      out += link ? `<a href="${escape(link.href)}">${styled}</a>` : styled;
    }

    return out;
  }

  function renderTextChunk(chunkStart: number, chunkEnd: number) {
    let html = "";
    let paraStart = chunkStart;
    let i = chunkStart;

    function flushParagraph(rawStart: number, rawEnd: number) {
      let s = rawStart;
      let e = rawEnd;
      while (s < e && /\s/.test(chars[s])) s++;
      while (e > s && /\s/.test(chars[e - 1])) e--;
      if (s < e) {
        html += `<p>${renderInline(s, e)}</p>`;
      }
    }

    while (i < chunkEnd) {
      if (chars[i] === "\n" || chars[i] === "\r") {
        let j = i;
        let newlineCount = 0;
        while (j < chunkEnd) {
          if (chars[j] === "\r") {
            if (j + 1 < chunkEnd && chars[j + 1] === "\n") j += 2;
            else j += 1;
            newlineCount++;
          } else if (chars[j] === "\n") {
            j += 1;
            newlineCount++;
          } else if (chars[j] === " " || chars[j] === "\t") {
            j += 1;
          } else {
            break;
          }
        }
        if (newlineCount >= 2) {
          flushParagraph(paraStart, i);
          paraStart = j;
          i = j;
          continue;
        }
      }
      i++;
    }
    flushParagraph(paraStart, chunkEnd);
    return html;
  }

  let html = "";
  let cursor = 0;
  for (const item of inlineMedia) {
    if (item.index > cursor) {
      html += renderTextChunk(cursor, item.index);
    }
    html += renderMediaFigure(item.info);
    placedMediaIds.add(item.info.id);
    cursor = Math.max(cursor, item.index);
  }
  if (cursor < length) {
    html += renderTextChunk(cursor, length);
  }

  for (const info of mediaById.values()) {
    if (info.isPhoto && !placedMediaIds.has(info.id)) {
      html += renderMediaFigure(info);
    }
  }

  return html;
}
