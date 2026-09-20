// X Articles use Draft-style blocks, but GraphQL style names are title-cased
// and entityMap is an array of { key, value } entries rather than a record.
export type TwitterArticleContent = {
  content_state?: { blocks?: unknown; entityMap?: unknown };
  media_entities?: unknown;
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
