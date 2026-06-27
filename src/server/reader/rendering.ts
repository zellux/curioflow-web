import { JSDOM } from "jsdom";

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
