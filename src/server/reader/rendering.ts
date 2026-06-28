import { JSDOM } from "jsdom";

const MIN_TOC_HEADINGS = 3;
const LONG_FORM_WORDS = 1200;
const LONG_FORM_CHARS = 2500;

export type ReaderTocItem = {
  depth: 1 | 2;
  id: string;
  level: number;
  number: string;
  title: string;
};

const ALLOWED_TAGS = new Set([
  "A",
  "ABBR",
  "B",
  "BLOCKQUOTE",
  "BR",
  "CODE",
  "DEL",
  "DIV",
  "EM",
  "FIGCAPTION",
  "FIGURE",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HR",
  "I",
  "IMG",
  "LI",
  "OL",
  "P",
  "PRE",
  "S",
  "SPAN",
  "STRONG",
  "SUB",
  "SUP",
  "TABLE",
  "TBODY",
  "TD",
  "TH",
  "THEAD",
  "TR",
  "U",
  "UL"
]);

const GLOBAL_ATTRS = new Set(["class", "title"]);

const TAG_ATTRS: Record<string, Set<string>> = {
  A: new Set(["href", "name"]),
  IMG: new Set(["src", "alt", "width", "height", "loading"]),
  TD: new Set(["colspan", "rowspan"]),
  TH: new Set(["colspan", "rowspan"])
};

function isSafeUrl(value: string) {
  if (value.startsWith("#") || value.startsWith("/")) return true;

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:";
  } catch {
    return false;
  }
}

function unwrapElement(element: Element) {
  const parent = element.parentNode;
  if (!parent) return;

  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element);
  }

  parent.removeChild(element);
}

function sanitizeElement(element: Element) {
  const tagName = element.tagName;

  if (["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "FORM", "INPUT", "BUTTON"].includes(tagName)) {
    element.remove();
    return;
  }

  if (!ALLOWED_TAGS.has(tagName)) {
    unwrapElement(element);
    return;
  }

  for (const attr of Array.from(element.attributes)) {
    const name = attr.name.toLowerCase();
    const isAllowed = GLOBAL_ATTRS.has(name) || TAG_ATTRS[tagName]?.has(name);

    if (!isAllowed || name.startsWith("on")) {
      element.removeAttribute(attr.name);
      continue;
    }

    if ((name === "href" || name === "src") && !isSafeUrl(attr.value)) {
      element.removeAttribute(attr.name);
    }
  }

  if (tagName === "A") {
    element.setAttribute("target", "_blank");
    element.setAttribute("rel", "noreferrer");
  }

  if (tagName === "IMG" && element.getAttribute("src")) {
    element.setAttribute("loading", "lazy");
  }
}

function wordCount(text: string) {
  return text.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)?/g)?.length ?? 0;
}

function compactCharCount(text: string) {
  return text.replace(/\s+/g, "").length;
}

function isLongFormText(text: string) {
  return wordCount(text) >= LONG_FORM_WORDS || compactCharCount(text) >= LONG_FORM_CHARS;
}

function slugPart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);
}

export function sanitizeArticleHtmlWithToc(html: string | null | undefined, fallbackText: string | null | undefined, idPrefix: string) {
  if (!html) return { html: null, tocItems: [] as ReaderTocItem[] };

  const dom = new JSDOM(`<main>${html}</main>`);
  const main = dom.window.document.querySelector("main");
  if (!main) return { html: null, tocItems: [] as ReaderTocItem[] };

  for (const element of Array.from(main.querySelectorAll("*"))) {
    sanitizeElement(element);
  }

  const headingEntries = Array.from(main.querySelectorAll("h1, h2, h3, h4"))
    .map((heading) => {
      const level = Number(heading.tagName.slice(1));
      const title = heading.textContent?.replace(/\s+/g, " ").trim();
      return { heading, level, title };
    })
    .filter((entry): entry is { heading: Element; level: number; title: string } => Boolean(entry.title) && Number.isFinite(entry.level));
  const primaryLevel = Math.min(...headingEntries.map((heading) => heading.level));
  let primaryCount = 0;
  let secondaryCount = 0;
  const tocItems = headingEntries
    .map(({ heading, level, title }, index): ReaderTocItem => {
      const depth = level === primaryLevel ? 1 : 2;
      if (depth === 1) {
        primaryCount += 1;
        secondaryCount = 0;
      } else {
        if (primaryCount === 0) primaryCount = 1;
        secondaryCount += 1;
      }
      const primaryNumber = String(primaryCount).padStart(2, "0");
      const number = depth === 1 ? primaryNumber : `${primaryNumber}.${secondaryCount}`;
      const id = `toc-${idPrefix}-${index + 1}-${slugPart(title) || "section"}`;
      heading.setAttribute("id", id);
      heading.setAttribute("data-toc-section", id);
      heading.setAttribute("data-toc-depth", String(depth));
      heading.setAttribute("data-toc-number", number);
      return {
        depth,
        id,
        level,
        number,
        title
      };
    });
  const sanitized = main.innerHTML.trim();
  const longFormText = fallbackText ?? main.textContent ?? "";
  const shouldShowToc = tocItems.length >= MIN_TOC_HEADINGS && isLongFormText(longFormText);

  return {
    html: sanitized || null,
    tocItems: shouldShowToc ? tocItems : []
  };
}

export function sanitizeArticleHtml(html: string | null | undefined) {
  if (!html) return null;

  const dom = new JSDOM(`<main>${html}</main>`);
  const main = dom.window.document.querySelector("main");
  if (!main) return null;

  for (const element of Array.from(main.querySelectorAll("*"))) {
    sanitizeElement(element);
  }

  const sanitized = main.innerHTML.trim();
  return sanitized || null;
}

export function getExtractionNote(metadataJson: string | null | undefined) {
  if (!metadataJson) return null;

  try {
    const metadata = JSON.parse(metadataJson) as {
      extractor?: string;
      fallbackReason?: string;
      siteName?: string | null;
    };

    if (metadata.extractor === "mock" && metadata.fallbackReason) {
      return `Readable extraction fell back to a local preview: ${metadata.fallbackReason}`;
    }

    if (metadata.extractor === "readability") return null;
  } catch {
    return null;
  }

  return null;
}
