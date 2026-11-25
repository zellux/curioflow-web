export type ReadingFontKey = "serif" | "sans" | "brush";

export const BASE_UI_FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400..700&family=IBM+Plex+Mono:wght@400;500&display=swap";

export const READING_FONT_STYLESHEETS: Record<ReadingFontKey, readonly string[]> = {
  serif: [
    "https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400..700;1,8..60,400..700&family=Noto+Serif+SC:wght@400;500;600&display=swap"
  ],
  sans: [
    "https://fonts.googleapis.com/css2?family=Nunito+Sans:ital,opsz,wght@0,6..12,400..700;1,6..12,400..700&family=Noto+Sans+SC:wght@400;500;600&display=swap"
  ],
  brush: [
    "https://fonts.googleapis.com/css2?family=Alegreya:ital,wght@0,400..700;1,400..700&display=swap",
    "https://cdn.jsdelivr.net/npm/lxgw-wenkai-screen-webfont@1.1.0/style.css"
  ]
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
