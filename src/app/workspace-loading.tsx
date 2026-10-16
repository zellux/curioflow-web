"use client";

import { usePathname } from "next/navigation";
import { ContentSkeleton } from "@/app/content-skeleton";
import { useNavigationState } from "@/app/navigation-state";

export default function WorkspaceLoading() {
  const { locale } = useNavigationState();
  const pathname = usePathname();
  return <div className="scrollArea"><ContentSkeleton locale={locale} reader={pathname.startsWith("/item/")} /></div>;
}
