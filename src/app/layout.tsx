import { ItemNoticeToast } from "@/app/item-notice";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ThemeController } from "@/app/theme-controller";
import { BASE_UI_FONTS_HREF, readingFontStylesheets } from "@/app/reading-fonts";
import "katex/dist/katex.min.css";
import "./base.css";
import "./app-shell.css";
import "./sidebar.css";
import "./feed-items.css";
import "./briefing.css";
import "./reader-summary.css";
import "./reader-progress.css";
import "./reader-notes.css";
import "./reader-article.css";
import "./reader-toc.css";
import "./reader-shell.css";
import "./job-status.css";
import "./settings.css";
import "./source-dialog.css";
import "./shared-ui.css";
import "./globals.css";
import "./public-pages.css";

const appTitle = process.env.NODE_ENV === "development" ? "Curioflow · Dev" : "Curioflow";
const sidebarSourceSectionPreferenceScript = `(() => {
  let section;
  try {
    const stored = window.localStorage.getItem("curioflow-sidebar-open-source-section");
    const legacyFeedsOpen = window.localStorage.getItem("curioflow-sidebar-feeds-open");
    section = stored === "feeds" || stored === "newsletters"
      ? stored
      : stored === "none" || legacyFeedsOpen === "0"
        ? "none"
        : "feeds";
  } catch {
    section = "feeds";
  }
  document.documentElement.dataset.sidebarSourceSection = section;
})();`;

function normalizeReadingFont(value: string | undefined) {
  if (value === "sans" || value === "journal") return "sans";
  if (value === "brush" || value === "quiet") return "brush";
  return "serif";
}

function normalizeColorMode(value: string | undefined) {
  return value === "dark" || value === "system" ? value : "bright";
}

function normalizeReadingWidth(value: string | undefined) {
  if (value === "narrow" || value === "wide") return value;
  return "medium";
}

function normalizeHtmlLang(value: string | undefined) {
  return value === "zh-Hans" ? "zh-Hans" : "en";
}

export const metadata: Metadata = {
  title: appTitle,
  description: "Personal reading flow and knowledge library"
};

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const font = normalizeReadingFont(cookieStore.get("curioflow-reading-font")?.value);
  const colorMode = normalizeColorMode(cookieStore.get("curioflow-color-mode")?.value);
  const readingWidth = normalizeReadingWidth(cookieStore.get("curioflow-reading-width")?.value);
  const htmlLang = normalizeHtmlLang(cookieStore.get("curioflow-system-language")?.value);
  const fontStylesheets = readingFontStylesheets(font);
  const htmlClassName = [
    font === "sans" ? "font-sans" : null,
    font === "brush" ? "font-brush" : null,
    colorMode === "dark" ? "color-dark" : null,
    colorMode === "system" ? "color-system" : null,
    readingWidth !== "medium" ? `reading-width-${readingWidth}` : null
  ].filter(Boolean).join(" ");

  return (
    <html
      className={htmlClassName || undefined}
      data-color-mode={colorMode}
      data-reading-font={font}
      data-reading-width={readingWidth}
      data-sidebar-source-section="feeds"
      lang={htmlLang}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: sidebarSourceSectionPreferenceScript }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {font === "brush" ? <link rel="preconnect" href="https://cdn.jsdelivr.net" /> : null}
        <link rel="stylesheet" href={BASE_UI_FONTS_HREF} />
        {fontStylesheets.map((href) => (
          <link key={href} rel="stylesheet" href={href} data-reading-font-sheet={font} />
        ))}
      </head>
      <body>
        <ThemeController />
        {children}
        <ItemNoticeToast />
      </body>
    </html>
  );
}
