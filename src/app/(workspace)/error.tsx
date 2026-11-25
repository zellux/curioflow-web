"use client";

import Link from "next/link";
import { pickLocale } from "@/app/i18n";
import { useNavigationState } from "@/app/navigation-state";

export default function WorkspaceError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { locale } = useNavigationState();
  const copy = pickLocale(locale, {
    en: {
      title: "Could not load this page",
      body: "Try again, or open another page from the sidebar.",
      retry: "Try again",
      back: "Back to library"
    },
    "zh-Hans": {
      title: "内容加载失败",
      body: "请重试，或从侧栏打开其他页面。",
      retry: "重试",
      back: "返回资料库"
    },
    "zh-Hant": {
      title: "無法載入此頁面",
      body: "請重試，或從側邊欄開啟其他頁面。",
      retry: "重試",
      back: "返回資料庫"
    },
    ja: {
      title: "このページを読み込めませんでした",
      body: "もう一度試すか、サイドバーから別のページを開いてください。",
      retry: "再試行",
      back: "ライブラリに戻る"
    },
    ko: {
      title: "이 페이지를 불러올 수 없습니다",
      body: "다시 시도하거나 사이드바에서 다른 페이지를 열어 보세요.",
      retry: "다시 시도",
      back: "라이브러리로 돌아가기"
    }
  });
  return <div className="scrollArea"><div className="libraryView contentLoadError" role="alert">
    <h1>{copy.title}</h1>
    <p>{copy.body}</p>
    <button type="button" className="subtleActionButton" onClick={reset}>{copy.retry}</button>
    <Link href="/home">{copy.back}</Link>
  </div></div>;
}
