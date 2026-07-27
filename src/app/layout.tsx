import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ThemeController } from "@/app/theme-controller";
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

const googleFontsHref =
  "https://fonts.googleapis.com/css2?family=Spectral:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400;1,500&family=Petrona:ital,wght@0,400;0,500;0,600;0,700;1,400&family=IBM+Plex+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500&family=Space+Mono:wght@400;700&family=Noto+Serif+SC:wght@400;500;600&family=Noto+Sans+SC:wght@400;500;600&display=swap";

const appTitle = process.env.NODE_ENV === "development" ? "Curioflow · Dev" : "Curioflow";
const sidebarFeedsPreferenceScript = `(() => {
  let open;
  try {
    const stored = window.localStorage.getItem("curioflow-sidebar-feeds-open");
    open = stored === "0" ? false : stored === "1" ? true : !window.matchMedia("(max-width: 640px)").matches;
  } catch {
    open = !window.matchMedia("(max-width: 640px)").matches;
  }
  document.documentElement.dataset.sidebarFeedsOpen = open ? "1" : "0";
})();`;

function normalizeReadingFont(value: string | undefined) {
  if (value === "sans" || value === "journal") return "sans";
  if (value === "brush" || value === "quiet") return "brush";
  return "serif";
}

function normalizeColorMode(value: string | undefined) {
  return value === "dark" ? "dark" : "bright";
}

function normalizeReadingWidth(value: string | undefined) {
  if (value === "narrow" || value === "wide") return value;
  return "medium";
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
  const htmlClassName = [
    font === "sans" ? "font-sans" : null,
    font === "brush" ? "font-brush" : null,
    colorMode === "dark" ? "color-dark" : null,
    readingWidth !== "medium" ? `reading-width-${readingWidth}` : null
  ].filter(Boolean).join(" ");

  return (
    <html
      className={htmlClassName || undefined}
      data-color-mode={colorMode}
      data-reading-font={font}
      data-reading-width={readingWidth}
      data-sidebar-feeds-open="1"
      lang="en"
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: sidebarFeedsPreferenceScript }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://cdn.jsdelivr.net" />
        <link rel="stylesheet" href={googleFontsHref} />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/lxgw-wenkai-screen-webfont@1.1.0/style.css"
        />
      </head>
      <body>
        <ThemeController />
        {children}
      </body>
    </html>
  );
}
