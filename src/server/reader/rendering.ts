import { JSDOM } from "jsdom";

const MIN_TOC_HEADINGS = 3;
const LONG_FORM_WORDS = 1200;
const LONG_FORM_CHARS = 2500;

export type ReaderTocItem = {
  id: string;
  level: number;
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

  const headings = Array.from(main.querySelectorAll("h2, h3, h4"));
  const tocItems = headings
    .map((heading, index): ReaderTocItem | null => {
      const title = heading.textContent?.replace(/\s+/g, " ").trim();
      if (!title) return null;

      const id = `toc-${idPrefix}-${index + 1}-${slugPart(title) || "section"}`;
      heading.setAttribute("id", id);
      heading.setAttribute("data-toc-section", id);
      heading.setAttribute("data-toc-number", String(index + 1).padStart(2, "0"));
      return {
        id,
        level: Number(heading.tagName.slice(1)),
        title
      };
    })
    .filter((item): item is ReaderTocItem => Boolean(item));
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
