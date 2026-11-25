export type ReadingFontKey = "serif" | "sans" | "brush";

export const BASE_UI_FONTS_HREF = "/fonts/base-ui.css";

export const READING_FONT_STYLESHEETS: Record<ReadingFontKey, readonly string[]> = {
  serif: ["/fonts/reading-serif.css"],
  sans: ["/fonts/reading-sans.css"],
  brush: ["/fonts/reading-brush.css"]
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
