"use client";

import Link from "next/link";
import { useNavigationState } from "@/app/navigation-state";

export default function WorkspaceNotFound() {
  const zh = useNavigationState().locale === "zh-Hans";
  return <div className="scrollArea"><div className="libraryView contentLoadError">
    <h1>{zh ? "找不到这篇文章" : "Article not found"}</h1>
    <p>{zh ? "文章可能已被删除，或不在当前资料库中。" : "It may have been deleted or belong to another library."}</p>
    <Link href="/home">{zh ? "返回资料库" : "Back to library"}</Link>
  </div></div>;
}
