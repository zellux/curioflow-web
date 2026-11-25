export type ReadingFontKey = "serif" | "sans" | "brush";

// Font stylesheets are served with a day-long public cache (and Cloudflare in front), so
// bump this whenever the files under public/fonts change to make clients fetch the new CSS.
const FONT_STYLESHEET_VERSION = "2026-11-25";

function versioned(href: string) {
  return `${href}?v=${FONT_STYLESHEET_VERSION}`;
}

export const BASE_UI_FONTS_HREF = versioned("/fonts/base-ui.css");

export const READING_FONT_STYLESHEETS: Record<ReadingFontKey, readonly string[]> = {
  serif: [versioned("/fonts/reading-serif.css")],
  sans: [versioned("/fonts/reading-sans.css")],
  brush: [versioned("/fonts/reading-brush.css")]
};

export function readingFontStylesheets(font: ReadingFontKey): readonly string[] {
  return READING_FONT_STYLESHEETS[font];
}

export function ensureReadingFontStylesheets(font: ReadingFontKey) {
  if (typeof document === "undefined") return;
  for (const href of READING_FONT_STYLESHEETS[font]) {
    if (document.head.querySelector(`link[rel="stylesheet"][href="${CSS.escape(href)}"]`)) continue;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.readingFontSheet = font;
    document.head.appendChild(link);
  }
}

export function ensureAllReadingFontStylesheets() {
  ensureReadingFontStylesheets("serif");
  ensureReadingFontStylesheets("sans");
  ensureReadingFontStylesheets("brush");
}
