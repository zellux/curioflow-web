import type { Metadata } from "next";
import { ThemeController } from "@/app/theme-controller";
import "./globals.css";

const googleFontsHref =
  "https://fonts.googleapis.com/css2?family=Spectral:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400;1,500&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&family=Petrona:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Hanken+Grotesk:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500&family=Space+Mono:wght@400;700&family=Noto+Serif+SC:wght@400;500;600&family=Noto+Sans+SC:wght@400;500;600&display=swap";

export const metadata: Metadata = {
  title: "Curioflow",
  description: "Personal reading flow and knowledge library"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
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
