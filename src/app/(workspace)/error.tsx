"use client";

import Link from "next/link";
import { useNavigationState } from "@/app/navigation-state";

export default function WorkspaceError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const zh = useNavigationState().locale === "zh-Hans";
  return <div className="scrollArea"><div className="libraryView contentLoadError" role="alert">
    <h1>{zh ? "内容加载失败" : "Could not load this page"}</h1>
    <p>{zh ? "请重试，或从侧栏打开其他页面。" : "Try again, or open another page from the sidebar."}</p>
    <button type="button" className="subtleActionButton" onClick={reset}>{zh ? "重试" : "Try again"}</button>
    <Link href="/home">{zh ? "返回资料库" : "Back to library"}</Link>
  </div></div>;
}
