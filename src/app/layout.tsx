import type { Metadata } from "next";
import { ThemeController } from "@/app/theme-controller";
import "./globals.css";

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
      <body>
        <ThemeController />
        {children}
      </body>
    </html>
  );
}
